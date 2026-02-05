/**
 * SURVIVOR Token Data Fetcher
 * Built by SURVIVOR Agent #598
 */

const { Connection, PublicKey } = require('@solana/web3.js');

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC, 'confirmed');

async function getTokenMintInfo(mintAddress) {
  const mintPubkey = new PublicKey(mintAddress);
  const accountInfo = await connection.getParsedAccountInfo(mintPubkey);
  if (!accountInfo.value || !accountInfo.value.data.parsed) throw new Error('Invalid token mint');
  const parsed = accountInfo.value.data.parsed.info;
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
  try {
    const mintPubkey = new PublicKey(mintAddress);
    const largestAccounts = await connection.getTokenLargestAccounts(mintPubkey);
    
    if (!largestAccounts.value || largestAccounts.value.length === 0) {
      return { totalHolders: 0, top10HolderPercent: 100, topHolders: [] };
    }
    
    const totalFromTop = largestAccounts.value.reduce((sum, acc) => sum + Number(acc.amount), 0);
    const top10 = largestAccounts.value.slice(0, 10);
    const top10Amount = top10.reduce((sum, acc) => sum + Number(acc.amount), 0);
    const top10Percent = totalFromTop > 0 ? (top10Amount / totalFromTop) * 100 : 100;
    
    return {
      totalHolders: largestAccounts.value.length,
      top10HolderPercent: Math.round(top10Percent * 100) / 100,
      topHolders: top10.map((acc, i) => ({
        rank: i + 1,
        address: acc.address.toString(),
        amount: acc.amount,
        percent: totalFromTop > 0 ? (Number(acc.amount) / totalFromTop) * 100 : 0,
      })),
    };
  } catch (error) {
    const msg = String(error?.message || error);
    // Handle mega-cap tokens gracefully
    if (msg.includes('Too many accounts') || msg.includes('429')) {
      console.log(`[SURVIVOR] Mega-cap detected, using fallback for holder distribution`);
      return {
        totalHolders: null,
        top10HolderPercent: null,
        topHolders: [],
        note: 'MEGA_CAP_FALLBACK',
      };
    }
    throw error;
  }
}

async function getDexScreenerData(mintAddress) {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.pairs || data.pairs.length === 0) return null;
    
    const mainPair = data.pairs.reduce((best, pair) =>
      (pair.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? pair : best
    );
    
    return {
      name: mainPair.baseToken?.name || 'Unknown',
      symbol: mainPair.baseToken?.symbol || 'UNKNOWN',
      priceUsd: parseFloat(mainPair.priceUsd) || 0,
      liquidityUsd: mainPair.liquidity?.usd || 0,
      volume24h: mainPair.volume?.h24 || 0,
      priceChange24h: mainPair.priceChange?.h24 || 0,
      pairAddress: mainPair.pairAddress,
      dexId: mainPair.dexId,
      createdAt: mainPair.pairCreatedAt,
    };
  } catch (error) {
    console.error(`[SURVIVOR] DexScreener error:`, error.message);
    return null;
  }
}

function calculateTokenAge(createdAt) {
  if (!createdAt) return 0;
  const created = typeof createdAt === 'string' ? new Date(createdAt) : new Date(createdAt);
  return Math.max(0, (new Date() - created) / (1000 * 60 * 60));
}

async function fetchTokenData(mintAddress) {
  console.log(`[SURVIVOR] Fetching data for: ${mintAddress}`);
  
  const [mintInfo, holders, dexData] = await Promise.all([
    getTokenMintInfo(mintAddress),
    getHolderDistribution(mintAddress),
    getDexScreenerData(mintAddress),
  ]);
  
  const ageInHours = dexData?.createdAt ? calculateTokenAge(dexData.createdAt) : 0;
  
  return {
    address: mintAddress,
    name: dexData?.name || 'Unknown',
    symbol: dexData?.symbol || 'UNKNOWN',
    mintAuthorityRevoked: mintInfo.mintAuthorityRevoked,
    freezeAuthorityRevoked: mintInfo.freezeAuthorityRevoked,
    decimals: mintInfo.decimals,
    supply: mintInfo.supply,
    totalHolders: holders.totalHolders,
    top10HolderPercent: holders.top10HolderPercent,
    topHolders: holders.topHolders,
    holderNote: holders.note || null,
    priceUsd: dexData?.priceUsd || 0,
    liquidityUsd: dexData?.liquidityUsd || 0,
    volume24h: dexData?.volume24h || 0,
    ageInHours,
    createdAt: dexData?.createdAt,
    lpInfo: { locked: false, lockDuration: 0, percentLocked: 0 },
    devActivity: null,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { fetchTokenData, getTokenMintInfo, getHolderDistribution, getDexScreenerData };
