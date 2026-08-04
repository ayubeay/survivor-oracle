/**
 * SURVIVOR Token Data Fetcher
 * Built by SURVIVOR Agent #598
 * v0.4.0: mint validation, DexScreener address matching, sanitization, megacap context
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { sanitizeText } = require('./sanitizer');

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const MEGACAP_MINTS = {
  'So11111111111111111111111111111111111111112': {
    name: 'Wrapped SOL', symbol: 'SOL', mode: 'MEGACAP', baseScore: 85, riskLevel: 'LOW',
    reasons: ['MEGACAP_TOKEN', 'ESTABLISHED', 'NATIVE_ASSET'],
  },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
    name: 'USD Coin', symbol: 'USDC', mode: 'MEGACAP', baseScore: 82, riskLevel: 'LOW',
    reasons: ['MEGACAP_TOKEN', 'ESTABLISHED', 'STABLECOIN_ISSUER_CONTROLLED'],
  },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
    name: 'Tether USD', symbol: 'USDT', mode: 'MEGACAP', baseScore: 78, riskLevel: 'LOW',
    reasons: ['MEGACAP_TOKEN', 'ESTABLISHED', 'STABLECOIN_ISSUER_CONTROLLED'],
  },
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB': {
    name: 'World Liberty Financial USD', symbol: 'USD1', mode: 'MEGACAP', baseScore: 55, riskLevel: 'MEDIUM',
    reasons: ['MEGACAP_TOKEN', 'ESTABLISHED', 'STABLECOIN_ISSUER_CONTROLLED'],
  },
};

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC, 'confirmed');

function isMegacap(mintAddress) { return mintAddress in MEGACAP_MINTS; }
function getMegacapData(mintAddress) { return MEGACAP_MINTS[mintAddress] || null; }

async function validateMint(mintAddress) {
  try {
    var pubkey = new PublicKey(mintAddress);
    var info = await connection.getAccountInfo(pubkey);
    if (!info) return { valid: false, reason: 'ACCOUNT_NOT_FOUND' };
    var owner = info.owner.toBase58();
    if (owner !== TOKEN_PROGRAM_ID && owner !== TOKEN_2022_PROGRAM_ID) {
      return { valid: false, reason: 'NOT_A_TOKEN_MINT', owner: owner };
    }
    if (owner === TOKEN_PROGRAM_ID && info.data.length !== 82) {
      return { valid: false, reason: 'NOT_A_MINT_ACCOUNT', size: info.data.length };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: 'VALIDATION_ERROR', error: err.message };
  }
}

async function getTokenMintInfo(mintAddress) {
  var mintPubkey = new PublicKey(mintAddress);
  var accountInfo = await connection.getParsedAccountInfo(mintPubkey);
  if (!accountInfo.value || !accountInfo.value.data.parsed) throw new Error('Invalid token mint');
  var parsed = accountInfo.value.data.parsed.info;
  return {
    address: mintAddress, decimals: parsed.decimals, supply: parsed.supply,
    mintAuthority: parsed.mintAuthority, freezeAuthority: parsed.freezeAuthority,
    mintAuthorityRevoked: parsed.mintAuthority === null,
    mintAuthorityRaw: parsed.mintAuthority,
    freezeAuthorityRevoked: parsed.freezeAuthority === null,
  };
}

/* Layer 1: mint authority classification from on-chain evidence only.
   Reports what can be proven from the mint address. Does not infer which program
   controls a PDA - that is not derivable from the mint and belongs to Layer 2. */
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

async function classifyMintAuthority(mintAddress, mintAuthority) {
  if (!mintAuthority) {
    return { state: 'REVOKED', authority: null, evidence: 'mint authority is null on the mint account' };
  }
  try {
    var authPk = new PublicKey(mintAuthority);
    var onCurve = PublicKey.isOnCurve(authPk.toBytes());
    var info = await connection.getAccountInfo(authPk);
    var owner = info ? info.owner.toBase58() : null;

    if (!onCurve) {
      return {
        state: 'PROGRAM_DERIVED',
        authority: mintAuthority,
        authority_account_exists: !!info,
        authority_account_owner: owner,
        evidence: 'authority address is off the ed25519 curve, so it is program-derived and cannot be signed by a keypair',
        limitation: 'the controlling program is not derivable from the mint address alone; governance and upgradeability are unknown at this layer',
      };
    }

    if ((owner === TOKEN_PROGRAM || owner === TOKEN_2022_PROGRAM_ID) && info && info.data.length === 355 && info.data[2] === 1) {
      var m = info.data[0], n = info.data[1];
      var signers = [];
      for (var i = 0; i < n; i++) {
        signers.push(new PublicKey(info.data.slice(3 + i * 32, 35 + i * 32)).toBase58());
      }
      return {
        state: 'MULTISIG',
        authority: mintAuthority,
        threshold_m: m, signers_n: n, signers: signers,
        evidence: 'authority is an initialized SPL Token multisig requiring ' + m + ' of ' + n + ' signatures',
      };
    }

    if (owner === SYSTEM_PROGRAM) {
      return {
        state: 'WALLET',
        authority: mintAuthority,
        evidence: 'authority is an on-curve system account; a single keypair can mint',
      };
    }

    return {
      state: 'ON_CURVE_OTHER',
      authority: mintAuthority,
      authority_account_owner: owner,
      evidence: 'authority is on-curve but owned by ' + (owner || 'no account'),
      limitation: 'control model not classified',
    };
  } catch (e) {
    return { state: 'UNRESOLVED', authority: mintAuthority, evidence: 'classification failed: ' + e.message };
  }
}

/* Layer 1 transfer-control classification. One question across both token programs:
   what observable authority or capability can restrict, redirect, tax, or disable a
   holder's transfer? Reports capabilities and who holds them. Does not infer intent -
   a permanent delegate is a disclosed power, not evidence of misuse. */

async function classifyAuthorityFor(addr) {
  if (!addr) return null;
  var c = await classifyMintAuthority(null, addr);
  return {
    authority: addr,
    authority_class: c.state,
    threshold_m: c.threshold_m,
    signers_n: c.signers_n,
  };
}

async function classifyTransferControl(mintAddress) {
  try {
    var pk = new PublicKey(mintAddress);
    var raw = await connection.getAccountInfo(pk);
    if (!raw) return { state: 'UNRESOLVED', reason: 'MINT_ACCOUNT_NOT_FOUND' };
    var program = raw.owner.toBase58() === TOKEN_2022_PROGRAM_ID ? 'TOKEN_2022' : 'CLASSIC_SPL';

    var parsed = await connection.getParsedAccountInfo(pk);
    var info = parsed.value && parsed.value.data && parsed.value.data.parsed
      ? parsed.value.data.parsed.info : null;
    if (!info) return { state: 'UNRESOLVED', program: program, reason: 'MINT_NOT_PARSEABLE' };

    var controls = [];

    if (info.freezeAuthority) {
      var fa = await classifyAuthorityFor(info.freezeAuthority);
      controls.push(Object.assign({ type: 'FREEZE_AUTHORITY', status: 'ACTIVE_CAPABILITY',
        effect: 'Can freeze token accounts, preventing transfer' }, fa));
    }

    var exts = info.extensions || [];
    for (var i = 0; i < exts.length; i++) {
      var e = exts[i], s = e.state || {};
      if (e.extension === 'permanentDelegate' && s.delegate) {
        var pd = await classifyAuthorityFor(s.delegate);
        controls.push(Object.assign({ type: 'PERMANENT_DELEGATE', status: 'ACTIVE_CAPABILITY',
          effect: 'Can transfer or burn from any token account without holder consent' }, pd));
      }
      if (e.extension === 'transferFeeConfig') {
        var bps = (s.newerTransferFee && s.newerTransferFee.transferFeeBasisPoints) || 0;
        var fee = await classifyAuthorityFor(s.transferFeeConfigAuthority);
        controls.push(Object.assign({
          type: 'TRANSFER_FEE',
          status: bps > 0 ? 'ACTIVE_CONSTRAINT' : 'PRESENT_INACTIVE',
          current_basis_points: bps,
          maximum_fee: (s.newerTransferFee && s.newerTransferFee.maximumFee) ?? null,
          mutable: !!s.transferFeeConfigAuthority,
          effect: bps > 0 ? 'Each transfer is taxed ' + (bps / 100) + '%'
                          : 'Fee is zero but the authority can raise it',
        }, fee));
      }
      if (e.extension === 'transferHook') {
        var hk = await classifyAuthorityFor(s.authority);
        controls.push(Object.assign({
          type: 'TRANSFER_HOOK',
          status: s.programId ? 'ACTIVE_CONSTRAINT' : 'PRESENT_LATENT',
          program_id: s.programId || null,
          effect: s.programId ? 'A program executes on every transfer and may block it'
                              : 'No hook installed, but the authority can install one',
        }, hk));
      }
      if (e.extension === 'defaultAccountState') {
        controls.push({ type: 'DEFAULT_ACCOUNT_STATE',
          status: s.accountState === 'frozen' ? 'ACTIVE_CONSTRAINT' : 'PRESENT_INACTIVE',
          account_state: s.accountState || null,
          effect: s.accountState === 'frozen'
            ? 'New token accounts are frozen until explicitly thawed'
            : 'New token accounts are created unfrozen' });
      }
      if (e.extension === 'nonTransferable') {
        controls.push({ type: 'NON_TRANSFERABLE', status: 'ACTIVE_CONSTRAINT',
          effect: 'Tokens cannot be transferred at all' });
      }
      if (e.extension === 'mintCloseAuthority' && s.closeAuthority) {
        var ca = await classifyAuthorityFor(s.closeAuthority);
        controls.push(Object.assign({ type: 'MINT_CLOSE_AUTHORITY', status: 'ACTIVE_CAPABILITY',
          effect: 'Can close the mint account' }, ca));
      }
      if (e.extension === 'pausable') {
        controls.push({ type: 'PAUSABLE', status: 'ACTIVE_CAPABILITY',
          effect: 'Transfers can be paused', raw: s });
      }
    }

    var state = 'UNCONTROLLED';
    if (controls.some(function (c) { return c.type === 'NON_TRANSFERABLE'; })) state = 'NON_TRANSFERABLE';
    else if (controls.some(function (c) { return c.status === 'ACTIVE_CONSTRAINT'; })) state = 'RESTRICTED';
    else if (controls.length) state = 'CONTROLLED';

    return {
      program: program, state: state, controls: controls,
      extensions_present: exts.map(function (e) { return e.extension; }),
      limitations: [
        'Capability does not imply misuse; these are disclosed powers, not evidence of intent',
        'Whether an authority address is held by one party, a custodian, or a quorum service is not derivable at Layer 1',
        'Transfer fees and hooks are mutable by their authority; values reported are current',
      ],
    };
  } catch (err) {
    return { state: 'UNRESOLVED', reason: 'CLASSIFICATION_FAILED: ' + err.message };
  }
}

async function getHolderDistribution(mintAddress) {
  if (isMegacap(mintAddress)) {
    console.log('[SURVIVOR] Megacap denylist hit, skipping holder query');
    return { totalHolders: null, top10HolderPercent: null, topHolders: [], note: 'MEGACAP_SKIP' };
  }
  var mintCheck = await validateMint(mintAddress);
  if (!mintCheck.valid) {
    console.log('[SURVIVOR] Skipping holder query for ' + mintAddress.slice(0, 12) + '...: ' + mintCheck.reason);
    return { totalHolders: null, top10HolderPercent: null, topHolders: [], note: mintCheck.reason };
  }
  try {
    var mintPubkey = new PublicKey(mintAddress);
    var largestAccounts;
    /* RPC congestion is a failure to observe, not an observation about the token. A 429
       under parallel load previously became HOLDER_QUERY_FAILED, silently dropping a
       15-weight signal and making the same token score differently depending on how busy
       we were. Retry transient failures; classify what actually happened. */
    var attempts = 0, lastCategory = null, lastMsg = null;
    while (attempts < 3) {
      attempts++;
      try {
        largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);
        break;
      } catch (lErr) {
        lastMsg = String(lErr && lErr.message ? lErr.message : lErr);
        var rateLimited = lastMsg.indexOf('429') >= 0 || lastMsg.toLowerCase().indexOf('too many requests') >= 0
          || lastMsg.indexOf('deprioritized') >= 0;
        var timedOut = lastMsg.toLowerCase().indexOf('timeout') >= 0 || lastMsg.indexOf('ETIMEDOUT') >= 0
          || lastMsg.indexOf('ECONNRESET') >= 0;
        /* Observed in practice: "account index service overloaded, please try again".
           Not a 429 and not a timeout, but explicitly transient - the node is asking us
           to retry. Treating it as terminal was wrong. */
        var overloaded = lastMsg.toLowerCase().indexOf('overloaded') >= 0
          || lastMsg.toLowerCase().indexOf('please try again') >= 0
          || lastMsg.toLowerCase().indexOf('service unavailable') >= 0;
        lastCategory = rateLimited ? 'HOLDER_QUERY_RATE_LIMITED'
          : timedOut ? 'HOLDER_QUERY_TIMEOUT'
          : overloaded ? 'HOLDER_QUERY_NODE_OVERLOADED' : 'HOLDER_QUERY_RPC_FAILED';
        var retryable = rateLimited || timedOut || overloaded;
        if (attempts >= 3 || !retryable) break;
        var backoff = (attempts === 1 ? 400 : 900) + Math.floor(Math.random() * 200);
        await new Promise(function (r) { setTimeout(r, backoff); });
      }
    }
    if (!largestAccounts) {
      console.log('[SURVIVOR] Holder query unavailable for ' + mintAddress.slice(0, 16) + '..: '
        + lastCategory + ' after ' + attempts + ' attempt(s)');
      return { totalHolders: null, top10HolderPercent: null, topHolders: [],
               note: lastCategory || 'HOLDER_QUERY_FAILED',
               observation_failure: { category: lastCategory, attempts: attempts,
                                      detail: (lastMsg || '').slice(0, 120) } };
    }
    if (!largestAccounts.value || largestAccounts.value.length === 0) {
      return { totalHolders: 0, top10HolderPercent: null, topHolders: [], note: 'NO_HOLDER_ACCOUNTS_RETURNED' };
    }
    var top10 = largestAccounts.value.slice(0, 10);
    /* getTokenLargestAccounts returns accounts, not owners. One owner splitting across
       several accounts reads as several holders - RAY's top 10 accounts resolve to 6
       owners, one holding 64% of the sample. Resolved in a single batched call. */
    var ownerAgg = null, distinctOwners = null, largestOwnerShare = null, ownerResolution = 'UNRESOLVED';
    try {
      var batch = await connection.getMultipleParsedAccounts(top10.map(function (a) { return a.address; }));
      var byOwner = {};
      var sampleTotal = 0n;
      for (var bi = 0; bi < top10.length; bi++) {
        var info = batch.value[bi] && batch.value[bi].data && batch.value[bi].data.parsed
          ? batch.value[bi].data.parsed.info : null;
        var own = info && info.owner ? info.owner : ('unresolved:' + bi);
        var amt = BigInt(top10[bi].amount);
        byOwner[own] = (byOwner[own] || 0n) + amt;
        sampleTotal += amt;
      }
      var sorted = Object.keys(byOwner).map(function (k) { return { owner: k, amount: byOwner[k] }; })
        .sort(function (x, y) { return y.amount > x.amount ? 1 : -1; });
      distinctOwners = sorted.length;
      largestOwnerShare = sampleTotal > 0n
        ? Number(sorted[0].amount * 10000n / sampleTotal) / 100 : null;
      ownerAgg = sorted.slice(0, 5).map(function (o) {
        return { owner: o.owner, share_of_sample: sampleTotal > 0n ? Number(o.amount * 10000n / sampleTotal) / 100 : null };
      });
      ownerResolution = 'RESOLVED';
    } catch (oErr) {
      ownerResolution = 'OWNER_RESOLUTION_FAILED';
    }
    // raw base units, same denomination as mint supply - percentage is computed in
    // fetchTokenData against total supply, not against the sampled accounts
    var top10RawUnits = largestAccounts.value.slice(0, 10)
      .reduce(function (sum, acc) { return sum + BigInt(acc.amount); }, 0n);
    var sampledRawUnits = largestAccounts.value
      .reduce(function (sum, acc) { return sum + BigInt(acc.amount); }, 0n);
    var totalFromTop = Number(sampledRawUnits);
    return {
      totalHolders: largestAccounts.value.length,
      accountsSampled: top10.length,
      distinctOwners: distinctOwners,
      largestOwnerShareOfSample: largestOwnerShare,
      topOwners: ownerAgg,
      ownerResolution: ownerResolution,
      top10RawUnits: top10RawUnits.toString(),
      sampledRawUnits: sampledRawUnits.toString(),
      top10HolderPercent: null,   // set by fetchTokenData once supply is known
      topHolders: top10.map(function (acc, i) {
        return { rank: i + 1, address: acc.address.toString(), amount: acc.amount,
          percent: totalFromTop > 0 ? (Number(acc.amount) / totalFromTop) * 100 : 0 };
      }),
    };
  } catch (error) {
    var msg = String(error && error.message ? error.message : error);
    if (msg.includes('Too many accounts') || msg.includes('429') || msg.includes('deprioritized')) {
      console.log('[SURVIVOR] Mega-cap detected, using fallback for holder distribution');
      return { totalHolders: null, top10HolderPercent: null, topHolders: [], note: 'MEGA_CAP_FALLBACK' };
    }
    throw error;
  }
}

async function getDexScreenerData(mintAddress) {
  try {
    var response = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + mintAddress);
    if (!response.ok) return null;
    var data = await response.json();
    if (!data.pairs || data.pairs.length === 0) return null;
    var mainPair = data.pairs.reduce(function (best, pair) {
      return (pair.liquidity && pair.liquidity.usd || 0) > (best.liquidity && best.liquidity.usd || 0) ? pair : best;
    });
    var earliestCreatedAt = data.pairs.reduce(function (min, pair) {
      var t = pair.pairCreatedAt || 0;
      return (t && (!min || t < min)) ? t : min;
    }, 0);
    var totalLiquidityUsd = data.pairs.reduce(function (sum, pair) {
      return sum + ((pair.liquidity && pair.liquidity.usd) || 0);
    }, 0);
    var tokenData = null;
    if (mainPair.baseToken && mainPair.baseToken.address === mintAddress) tokenData = mainPair.baseToken;
    else if (mainPair.quoteToken && mainPair.quoteToken.address === mintAddress) tokenData = mainPair.quoteToken;
    else tokenData = mainPair.baseToken;
    return {
      name: (tokenData && tokenData.name) || 'Unknown',
      symbol: (tokenData && tokenData.symbol) || 'UNKNOWN',
      priceUsd: parseFloat(mainPair.priceUsd) || 0,
      liquidityUsd: (mainPair.liquidity && mainPair.liquidity.usd) || 0,
      volume24h: (mainPair.volume && mainPair.volume.h24) || 0,
      priceChange24h: (mainPair.priceChange && mainPair.priceChange.h24) || 0,
      pairAddress: mainPair.pairAddress, dexId: mainPair.dexId,
      createdAt: earliestCreatedAt || mainPair.pairCreatedAt,
      deepestPoolCreatedAt: mainPair.pairCreatedAt,
      observedTotalLiquidityUsd: totalLiquidityUsd, pairCount: data.pairs.length,
    };
  } catch (error) {
    console.error('[SURVIVOR] DexScreener error:', error.message);
    return null;
  }
}

function calculateTokenAge(createdAt) {
  if (!createdAt) return 0;
  var created = typeof createdAt === 'string' ? new Date(createdAt) : new Date(createdAt);
  return Math.max(0, (new Date() - created) / (1000 * 60 * 60));
}

async function fetchTokenData(mintAddress) {
  console.log('[SURVIVOR] Fetching data for: ' + mintAddress);
  var mega = getMegacapData(mintAddress);
  if (mega) {
    var mintInfo;
    try { mintInfo = await getTokenMintInfo(mintAddress); }
    catch (e) { mintInfo = { mintAuthorityRevoked: false, freezeAuthorityRevoked: false, decimals: 0, supply: '0', mintAuthorityRaw: null }; }
    // the fast path may skip costly market analysis, but not cheap decision-relevant facts
    var megaAuthorityClass = await classifyMintAuthority(mintAddress, mintInfo.mintAuthorityRaw);
    var megaTransferControl = await classifyTransferControl(mintAddress);
    return {
      address: mintAddress, name: mega.name, symbol: mega.symbol,
      mintAuthorityRevoked: mintInfo.mintAuthorityRevoked, freezeAuthorityRevoked: mintInfo.freezeAuthorityRevoked,
      mintAuthorityClass: megaAuthorityClass,
      transferControl: megaTransferControl,
      decimals: mintInfo.decimals, supply: mintInfo.supply,
      totalHolders: null, top10HolderPercent: null, topHolders: [], holderNote: 'MEGACAP_SKIP',
      priceUsd: null, liquidityUsd: null, volume24h: null, ageInHours: null, createdAt: null,
      lpInfo: null,
      devActivity: null, fetchedAt: new Date().toISOString(), megacap: mega,
    };
  }
  var results = await Promise.all([
    getTokenMintInfo(mintAddress), getHolderDistribution(mintAddress), getDexScreenerData(mintAddress),
  ]);
  var mintInfoResult = results[0]; var holders = results[1]; var dexData = results[2];
  var mintAuthorityClass = await classifyMintAuthority(mintAddress, mintInfoResult.mintAuthorityRaw);
  var transferControl = await classifyTransferControl(mintAddress);
  // concentration relative to total supply, not to the sampled accounts
  var concentrationBasis = null;
  try {
    var supplyRaw = BigInt(mintInfoResult.supply || '0');
    if (supplyRaw > 0n && holders && holders.top10RawUnits) {
      var t10 = BigInt(holders.top10RawUnits);
      holders.top10HolderPercent = Math.round(Number(t10 * 1000000n / supplyRaw) / 100) / 100;
      /* The share of TOTAL SUPPLY held by the single largest owner among the sampled
         accounts. Discriminates where top-10 concentration does not: RAY and TNSR both
         report ~76% top-10, but RAY's largest owner holds 49% of supply against TNSR's
         20%. Sampled from the top 10 accounts only - an owner holding an 11th account
         outside the sample is not counted. */
      if (typeof holders.largestOwnerShareOfSample === 'number' &&
          typeof holders.top10HolderPercent === 'number') {
        holders.largestOwnerPercentOfSupply =
          Math.round(holders.top10HolderPercent * holders.largestOwnerShareOfSample) / 100;
      }
      concentrationBasis = {
        denominator: 'total_supply',
        supply_raw: supplyRaw.toString(),
        accounts_sampled: holders.totalHolders,
        distinct_owners: holders.distinctOwners ?? null,
        owner_resolution: holders.ownerResolution ?? 'NOT_ATTEMPTED',
        largest_owner_percent_of_supply: holders.largestOwnerPercentOfSupply ?? null,
        largest_owner_share_of_sample: holders.largestOwnerShareOfSample ?? null,
        sampling_limit: 'largest owner among the top 10 accounts; an 11th account is not observed',
        sampled_raw_units: holders.sampledRawUnits,
      };
    }
  } catch (e) { console.log('[SURVIVOR] concentration calc failed: ' + e.message); }
  var ageInHours = dexData && dexData.createdAt ? calculateTokenAge(dexData.createdAt) : 0;
  return {
    address: mintAddress,
    name: sanitizeText(dexData && dexData.name || 'Unknown'),
    symbol: sanitizeText(dexData && dexData.symbol || 'UNKNOWN'),
    mintAuthorityRevoked: mintInfoResult.mintAuthorityRevoked,
    mintAuthorityRaw: mintInfoResult.mintAuthorityRaw,
    mintAuthorityClass: mintAuthorityClass,
    transferControl: transferControl,
    freezeAuthorityRevoked: mintInfoResult.freezeAuthorityRevoked,
    decimals: mintInfoResult.decimals, supply: mintInfoResult.supply,
    totalHolders: holders.totalHolders, top10HolderPercent: holders.top10HolderPercent,
    concentrationBasis: concentrationBasis,
    topHolders: holders.topHolders, holderNote: holders.note || null,
    priceUsd: dexData && dexData.priceUsd || 0, liquidityUsd: dexData && dexData.liquidityUsd || 0,
    pairAddress: dexData && dexData.pairAddress || null, dexId: dexData && dexData.dexId || null,
    observedTotalLiquidityUsd: dexData && dexData.observedTotalLiquidityUsd || null,
    pairCount: dexData && dexData.pairCount || null,
    volume24h: dexData && dexData.volume24h || 0, ageInHours: ageInHours,
    createdAt: dexData && dexData.createdAt,
    lpInfo: null,   // not measured - no LP lock data source is wired in
    devActivity: null, fetchedAt: new Date().toISOString(), megacap: null,
  };
}

module.exports = { fetchTokenData, getTokenMintInfo, getHolderDistribution, getDexScreenerData, isMegacap, getMegacapData, validateMint };
