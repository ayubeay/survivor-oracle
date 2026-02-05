/**
 * SURVIVOR Token Data Fetcher
 * Built by SURVIVOR Agent #598
 * v0.3.2: mint validation, DexScreener address matching, sanitization, megacap context
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { sanitizeText } = require('./sanitizer');

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const MEGACAP_MINTS = {
  'So11111111111111111111111111111111111111112': {
    name: 'Wrapped SOL', symbol: 'SOL', mode: 'MEGACAP',
    baseScore: 85, riskLevel: 'LOW',
    reasons: ['MEGACAP_TOKEN', 'ESTABLISHED', 'NATIVE_ASSET'],
  },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
    name: 'USD Coin', symbol: 'USDC', mode: 'MEGACAP',
    baseScore: 82, riskLevel: 'LOW',
    reasons: ['MEGACAP_TOKEN', 'ESTABLISHED', 'STABLECOIN_ISSUER_CONTROLLED'],
  },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
    name: 'Tether USD', symbol: 'USDT', mode: 'MEGACAP',
    baseScore: 78, riskLevel: 'LOW',
    reasons: ['MEGACAP_TOKEN', 'ESTABLISHED', 'STABLECOIN_ISSUER_CONTROLLED'],
  },
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB': {
    name: 'World Liberty Financial USD', symbol: 'USD1', mode: 'MEGACAP',
    baseScore: 55, riskLevel: 'MEDIUM',
    reasons: ['MEGACAP_TOKEN', 'ESTABLISHED', 'STABLECOIN_ISSUER_CONTROLLED'],
  },
};

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC, 'confirmed');

function isMegacap(mintAddress) {
  return mintAddress in MEGACAP_MINTS;
}

function getMegacapData(mintAddress) {
  return MEGACAP_MINTS[mintAddress] || null;
}

async function validateMint(mintAddress) {
  try {
    var pubkey = new PublicKey(mintAddress);
    var info = await connection.getAccountInfo(pubkey);
    if (!info) return { valid: false, reason: 'ACCOUNT_NOT_FOUND' };
    var owner = info.owner.toBase58();
    if (owner !== TOKEN_PROGRAM_ID && owner !== TOKEN_2022_PROGRAM_ID) {
      return { valid: false, reason: 'NOT_A_TOKEN_MINT', owner: owner };
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
    address: mintAddress,
    decimals: parsed.decimals,
    supply: parsed.supply,
    mintAuthority: parsed.mintAuthority,
    freezeAuthority: parsed.freezeAuthority,
    mintAuthorityRevoked: parsed.mintAuthority === null,
    freezeAuthorityRevoked: parsed.freezeAuthority === null,
  };
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
    var largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);

    if (!largestAccounts.value || largestAccounts.value.length === 0) {
      return { totalHolders: 0, top10HolderPercent: 100, topHolders: [] };
    }

    var totalFromTop = largestAccounts.value.reduce(function(sum, acc) { return sum + Number(acc.amount); }, 0);
    var top10 = largestAccounts.value.slice(0, 10);
    var top10Amount = top10.reduce(function(sum, acc) { return sum + Number(acc.amount); }, 0);
    var top10Percent = totalFromTop > 0 ? (top10Amount / totalFromTop) * 100 : 100;

    return {
      totalHolders: largestAccounts.value.length,
      top10HolderPercent: Math.round(top10Percent * 100) / 100,
      topHolders: top10.map(function(acc, i) {
        return {
          rank: i + 1,
          address: acc.address.toString(),
          amount: acc.amount,
          percent: totalFromTop > 0 ? (Number(acc.amount) / totalFromTop) * 100 : 0,
        };
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

    var mainPair = data.pairs.reduce(function(best, pair) {
      return (pair.liquidity && pair.liquidity.usd || 0) > (best.liquidity && best.liquidity.usd || 0) ? pair : best;
    });

    var tokenData = null;
    if (mainPair.baseToken && mainPair.baseToken.address === mintAddress) {
      tokenData = mainPair.baseToken;
    } else if (mainPair.quoteToken && mainPair.quoteToken.address === mintAddress) {
      tokenData = mainPair.quoteToken;
    } else {
      tokenData = mainPair.baseToken;
    }

    return {
      name: (tokenData && tokenData.name) || 'Unknown',
      symbol: (tokenData && tokenData.symbol) || 'UNKNOWN',
      priceUsd: parseFloat(mainPair.priceUsd) || 0,
      liquidityUsd: (mainPair.liquidity && mainPair.liquidity.usd) || 0,
      volume24h: (mainPair.volume && mainPair.volume.h24) || 0,
      priceChange24h: (mainPair.priceChange && mainPair.priceChange.h24) || 0,
      pairAddress: mainPair.pairAddress,
      dexId: mainPair.dexId,
      createdAt: mainPair.pairCreatedAt,
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
    try {
      mintInfo = await getTokenMintInfo(mintAddress);
    } catch (e) {
      mintInfo = { mintAuthorityRevoked: false, freezeAuthorityRevoked: false, decimals: 0, supply: '0' };
    }
    return {
      address: mintAddress,
      name: mega.name,
      symbol: mega.symbol,
      mintAuthorityRevoked: mintInfo.mintAuthorityRevoked,
      freezeAuthorityRevoked: mintInfo.freezeAuthorityRevoked,
      decimals: mintInfo.decimals,
      supply: mintInfo.supply,
      totalHolders: null,
      top10HolderPercent: null,
      topHolders: [],
      holderNote: 'MEGACAP_SKIP',
      priceUsd: 0,
      liquidityUsd: 999999999,
      volume24h: 0,
      ageInHours: 99999,
      createdAt: null,
      lpInfo: { locked: true, lockDuration: 9999, percentLocked: 100 },
      devActivity: null,
      fetchedAt: new Date().toISOString(),
      megacap: mega,
    };
  }

  var results = await Promise.all([
    getTokenMintInfo(mintAddress),
    getHolderDistribution(mintAddress),
    getDexScreenerData(mintAddress),
  ]);
  var mintInfoResult = results[0];
  var holders = results[1];
  var dexData = results[2];

  var ageInHours = dexData && dexData.createdAt ? calculateTokenAge(dexData.createdAt) : 0;

  return {
    address: mintAddress,
    name: sanitizeText(dexData && dexData.name || 'Unknown'),
    symbol: sanitizeText(dexData && dexData.symbol || 'UNKNOWN'),
    mintAuthorityRevoked: mintInfoResult.mintAuthorityRevoked,
    freezeAuthorityRevoked: mintInfoResult.freezeAuthorityRevoked,
    decimals: mintInfoResult.decimals,
    supply: mintInfoResult.supply,
    totalHolders: holders.totalHolders,
    top10HolderPercent: holders.top10HolderPercent,
    topHolders: holders.topHolders,
    holderNote: holders.note || null,
    priceUsd: dexData && dexData.priceUsd || 0,
    liquidityUsd: dexData && dexData.liquidityUsd || 0,
    volume24h: dexData && dexData.volume24h || 0,
    ageInHours: ageInHours,
    createdAt: dexData && dexData.createdAt,
    lpInfo: { locked: false, lockDuration: 0, percentLocked: 0 },
    devActivity: null,
    fetchedAt: new Date().toISOString(),
    megacap: null,
  };
}

module.exports = { fetchTokenData, getTokenMintInfo, getHolderDistribution, getDexScreenerData, isMegacap, getMegacapData, validateMint };
