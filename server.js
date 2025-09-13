const express = require('express');
const { Connection, Keypair, Transaction, VersionedTransaction } = require('@solana/web3.js');
const bs58 = require('bs58');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Environment variables
const JUPITER_API_KEY = process.env.JUPITER_API_KEY; // Optional - for enhanced rate limits
const PRIVATE_KEY = process.env.PRIVATE_KEY; // Base58 encoded private key
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // Optional webhook verification

const MOCK_MODE = process.env.MOCK_MODE === 'true';


// Initialize wallet from private key
let wallet;
try {
    if (!PRIVATE_KEY) {
        throw new Error('PRIVATE_KEY environment variable is required');
    }
    wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
    console.log('Wallet initialized:', wallet.publicKey.toString());
} catch (error) {
    console.error('Error initializing wallet:', error.message);
    process.exit(1);
}

// Jupiter API base URLs
const JUPITER_BASE_URL = JUPITER_API_KEY ? 'https://api.jup.ag' : 'https://lite-api.jup.ag';

// Find this function in your server.js and replace it:
async function makeJupiterRequest(endpoint, method = 'GET', body = null) {
    // Add this mock mode check at the very beginning
    const MOCK_MODE = process.env.MOCK_MODE === 'true';
    
    if (MOCK_MODE) {
        console.log(`🧪 Mock API Call: ${method} ${endpoint}`);
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
        
        if (endpoint.includes('/ultra/v1/balances')) {
            return {
                wallet: "CHK6qjF3WVg3xXSdTMLwFTXNmkitK2xaSRaiwZbX3wvG",
                balances: [
                    {
                        mint: "So11111111111111111111111111111111111111112",
                        symbol: "SOL",
                        amount: "5000000000", // 5 SOL
                        decimals: 9,
                        uiAmount: 5.0
                    },
                    {
                        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                        symbol: "USDC", 
                        amount: "1000000000", // 1000 USDC
                        decimals: 6,
                        uiAmount: 1000.0
                    }
                ],
                mockData: true
            };
        }
        
        // Handle other mock endpoints...
        if (endpoint.includes('/ultra/v1/order')) {
            const url = new URL(`https://example.com${endpoint}`);
            return {
                mode: "ultra",
                inputMint: url.searchParams.get('inputMint'),
                outputMint: url.searchParams.get('outputMint'), 
                inAmount: url.searchParams.get('amount'),
                outAmount: Math.floor(parseInt(url.searchParams.get('amount')) * 0.98).toString(),
                transaction: Buffer.from("mock-transaction").toString('base64'),
                requestId: `mock-${Date.now()}`
            };
        }
        
        if (endpoint === '/ultra/v1/execute') {
            return {
                status: "success",
                signature: `mock${Date.now()}`,
                requestId: body.requestId
            };
        }
        
        throw new Error(`Mock API: Unhandled endpoint ${endpoint}`);
    }

    // Original real API code...
    const headers = {
        'Content-Type': 'application/json',
    };
    
    if (JUPITER_API_KEY && !MOCK_MODE) {
    headers['X-API-Key'] = JUPITER_API_KEY;
    console.log('🔑 Using X-API-Key header');
}

    const config = {
        method,
        headers,
    };
    
    if (body && method !== 'GET') {
        config.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${process.env.JUPITER_API_KEY ? 'https://api.jup.ag' : 'https://lite-api.jup.ag'}${endpoint}`, config);
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Jupiter API error: ${response.status} - ${errorText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Jupiter API request failed:', error);
        throw error;
    }
}

// Function to get Jupiter swap quote/order
async function getSwapOrder(inputMint, outputMint, amount, slippageBps = null) {
    try {
        const params = new URLSearchParams({
            inputMint,
            outputMint,
            amount: amount.toString(),
            taker: wallet.publicKey.toString()
        });
        
        if (slippageBps !== null) {
            params.append('slippageBps', slippageBps.toString());
        }

        const orderResponse = await makeJupiterRequest(`/ultra/v1/order?${params}`);
        
        console.log('Swap order received:', {
            inputMint: orderResponse.inputMint,
            outputMint: orderResponse.outputMint,
            inAmount: orderResponse.inAmount,
            outAmount: orderResponse.outAmount,
            slippageBps: orderResponse.slippageBps,
            priceImpactPct: orderResponse.priceImpactPct
        });
        
        return orderResponse;
    } catch (error) {
        console.error('Error getting swap order:', error);
        throw error;
    }
}

// Function to execute signed transaction
async function executeSwap(signedTransactionBase64, requestId) {
    try {
        const executeResponse = await makeJupiterRequest('/ultra/v1/execute', 'POST', {
            signedTransaction: signedTransactionBase64,
            requestId: requestId
        });
        
        console.log('Swap execution result:', executeResponse);
        return executeResponse;
    } catch (error) {
        console.error('Error executing swap:', error);
        throw error;
    }
}

// Function to sign transaction
// Replace your signTransaction function with this updated version:
function signTransaction(transactionBase64) {
    try {
        const transactionBuffer = Buffer.from(transactionBase64, 'base64');
        
        // Try versioned transaction first (Jupiter Ultra API uses these)
        try {
            const { VersionedTransaction } = require('@solana/web3.js');
            const versionedTransaction = VersionedTransaction.deserialize(transactionBuffer);
            versionedTransaction.sign([wallet]);
            return Buffer.from(versionedTransaction.serialize()).toString('base64');
        } catch (versionedError) {
            console.log('Not a versioned transaction, trying legacy format...');
            
            // Fallback to legacy transaction
            const transaction = Transaction.from(transactionBuffer);
            transaction.sign(wallet);
            return transaction.serialize().toString('base64');
        }
    } catch (error) {
        console.error('Error signing transaction:', error);
        throw error;
    }
}

async function processAgentTransaction(eventData) {
    const { data } = eventData;
    
    console.log('Processing agent transaction:', {
        id: data.id,
        transaction_type: data.transaction_type,
        input_symbol: data.input_symbol,
        output_symbol: data.output_symbol,
        input_amount: data.input_amount,
        input_mint: data.input_mint,
        output_mint: data.output_mint
    });
    
    try {
        // Dynamically fetch token decimals
        console.log('🔍 Fetching token decimals...');
        const inputDecimals = await getTokenDecimals(data.input_mint);
        console.log(`💰 Token ${data.input_symbol} (${data.input_mint}) has ${inputDecimals} decimals`);
        
        // Convert amount using correct decimals
        const inputAmountLamports = Math.floor(data.input_amount * Math.pow(10, inputDecimals));
        
        console.log('💱 Amount conversion:', {
            originalAmount: data.input_amount,
            decimals: inputDecimals,
            convertedAmount: inputAmountLamports,
            symbol: data.input_symbol
        });
        
        let slippageBps;
        const isSellingToSOL = data.output_mint === 'So11111111111111111111111111111111111111112';
        const isPumpFunToken = data.input_mint.endsWith('pump') || data.input_symbol.toLowerCase().includes('pump');

        if (isSellingToSOL) {
            // Higher slippage for selling tokens (especially to SOL)
            if (isPumpFunToken) {
                slippageBps = 1000; // 10% for pump.fun token sales
            } else {
                slippageBps = 500;  // 5% for regular token sales
            }
        } else {
            // Lower slippage for buying tokens with SOL  
            slippageBps = data.slippage ? Math.floor(data.slippage * 10000) : 300; // 3%
        }

        console.log(`📊 Slippage strategy:`, {
            direction: isSellingToSOL ? 'SELL → SOL' : 'BUY with SOL',
            isPumpFun: isPumpFunToken,
            slippageBps: slippageBps,
            slippagePercent: `${slippageBps/100}%`
        });
        
        const orderResponse = await getSwapOrder(
            data.input_mint,
            data.output_mint,
            inputAmountLamports,
            slippageBps
        );
        
        if (!orderResponse.transaction) {
            return {
                success: false,
                transactionId: data.id,
                error: 'No executable transaction from Jupiter API',
                details: {
                    inputAmount: data.input_amount,
                    convertedAmount: inputAmountLamports,
                    decimals: inputDecimals,
                    priceImpact: orderResponse.priceImpactPct,
                    hasRoute: !!orderResponse.routePlan
                }
            };
        }
        
        // Continue with transaction signing and execution...
        const signedTransaction = signTransaction(orderResponse.transaction);
        const executeResponse = await executeSwap(signedTransaction, orderResponse.requestId);
        
        return {
            success: true,
            transactionId: data.id,
            jupiterRequestId: orderResponse.requestId,
            executionStatus: executeResponse.status,
            signature: executeResponse.signature,
            inputAmount: orderResponse.inAmount,
            outputAmount: orderResponse.outAmount,
            priceImpact: orderResponse.priceImpactPct,
            decimalsUsed: inputDecimals
        };
        
    } catch (error) {
        console.error('Error processing agent transaction:', error);
        return {
            success: false,
            transactionId: data.id,
            error: error.message
        };
    }
}

// Add this function to fetch token decimals dynamically
async function getTokenDecimals(tokenMint) {
    try {
        // Try Jupiter's token info API first
        console.log(`🔍 Fetching decimals for token: ${tokenMint}`);
        
        const response = await fetch(`https://tokens.jup.ag/token/${tokenMint}`);
        if (response.ok) {
            const tokenInfo = await response.json();
            console.log(`✅ Token info from Jupiter:`, tokenInfo);
            return tokenInfo.decimals;
        }
    } catch (error) {
        console.log('⚠️ Jupiter token API failed, trying alternative...');
    }
    
    try {
        // Alternative: Use Solana token list
        const response = await fetch('https://token.jup.ag/all');
        if (response.ok) {
            const allTokens = await response.json();
            const token = allTokens.find(t => t.address === tokenMint);
            if (token) {
                console.log(`✅ Found token in Jupiter list:`, token);
                return token.decimals;
            }
        }
    } catch (error) {
        console.log('⚠️ Jupiter token list failed');
    }
    
    // Fallback: Query Solana RPC directly
    try {
        console.log('🔄 Querying Solana RPC for mint info...');
        const connection = new Connection('https://api.mainnet-beta.solana.com');
        const { PublicKey } = require('@solana/web3.js');
        
        const mintInfo = await connection.getParsedAccountInfo(new PublicKey(tokenMint));
        if (mintInfo.value && mintInfo.value.data.parsed) {
            const decimals = mintInfo.value.data.parsed.info.decimals;
            console.log(`✅ Got decimals from Solana RPC: ${decimals}`);
            return decimals;
        }
    } catch (error) {
        console.log('⚠️ Solana RPC failed:', error.message);
    }
    
    // Final fallback
    console.log('⚠️ Using default 6 decimals');
    return 6;
}

// Function to process trade signal event
async function processTradeSignal(eventData) {
    const { data } = eventData;
    
    console.log('Processing trade signal:', {
        id: data.id,
        token_symbol: data.token_symbol,
        token_address: data.token_address,
        price_at_signal: data.price_at_signal,
        activation_reason: data.activation_reason
    });
    
    // For trade signals, we'll implement a basic strategy
    // This is a simplified example - you would implement your trading logic here
    
    // Default trade amount (you might want to make this configurable)
    const SOL_TRADE_AMOUNT = 0.1; // 0.1 SOL
    const inputAmountLamports = Math.floor(SOL_TRADE_AMOUNT * Math.pow(10, 9));
    
    // Default settings
    const inputMint = 'So11111111111111111111111111111111111111112'; // SOL
    const outputMint = data.token_address; // Target token from signal
    const slippageBps = 100; // 1% slippage for trade signals
    
    try {
        // Get swap order from Jupiter
        const orderResponse = await getSwapOrder(
            inputMint,
            outputMint,
            inputAmountLamports,
            slippageBps
        );
        
        if (!orderResponse.transaction) {
            throw new Error('No transaction received from Jupiter API');
        }
        
        // Sign the transaction
        const signedTransaction = signTransaction(orderResponse.transaction);
        
        // Execute the swap
        const executeResponse = await executeSwap(signedTransaction, orderResponse.requestId);
        
        return {
            success: true,
            signalId: data.id,
            tokenSymbol: data.token_symbol,
            tokenAddress: data.token_address,
            jupiterRequestId: orderResponse.requestId,
            executionStatus: executeResponse.status,
            signature: executeResponse.signature,
            inputAmount: orderResponse.inAmount,
            outputAmount: orderResponse.outAmount,
            priceImpact: orderResponse.priceImpactPct
        };
    } catch (error) {
        console.error('Error processing trade signal:', error);
        return {
            success: false,
            signalId: data.id,
            tokenSymbol: data.token_symbol,
            tokenAddress: data.token_address,
            error: error.message
        };
    }
}

// Main webhook endpoint
app.post('/webhook', async (req, res) => {
    try {
        const { event, timestamp, agentId, data } = req.body;
        
        console.log(`Received webhook event: ${event} at ${timestamp} for agent: ${agentId}`);
        
        let result;
        
        switch (event) {
            case 'agentTransactions':
                result = await processAgentTransaction({ event, timestamp, agentId, data });
                break;
            
            case 'tradeSignals':
                result = await processTradeSignal({ event, timestamp, agentId, data });
                break;
            
            default:
                console.log(`Unknown event type: ${event}`);
                return res.status(400).json({
                    success: false,
                    error: `Unknown event type: ${event}`
                });
        }
        
        // Log the result
        console.log('Webhook processing result:', result);
        
        // Respond with the result
        res.status(200).json({
            success: true,
            event,
            timestamp,
            agentId,
            result
        });
        
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Root endpoint - shows available routes
app.get('/', (req, res) => {
    res.json({
        name: 'Jupiter Webhook Server',
        status: 'running',
        timestamp: new Date().toISOString(),
        wallet: wallet.publicKey.toString(),
        endpoints: {
            'GET /': 'Server information and available endpoints',
            'GET /health': 'Health check endpoint',
            'GET /balance': 'Get wallet token balances',
            'POST /webhook': 'Main webhook endpoint for processing events',
            'POST /test-swap': 'Test swap endpoint (inputMint, outputMint, amount)'
        },
        sampleWebhookPayload: {
            agentTransactions: {
                event: 'agentTransactions',
                timestamp: '2024-01-01T12:00:00.000Z',
                agentId: 'agent-uuid',
                data: {
                    id: 456,
                    transaction_type: 'swap',
                    input_mint: 'So11111111111111111111111111111111111111112',
                    input_symbol: 'SOL',
                    input_amount: 0.01,
                    output_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    output_symbol: 'USDC',
                    slippage: 0.005
                }
            },
            tradeSignals: {
                event: 'tradeSignals',
                timestamp: '2024-01-01T12:00:00.000Z',
                agentId: 'agent-uuid',
                data: {
                    id: 123,
                    token_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    token_symbol: 'USDC',
                    price_at_signal: 1.0001,
                    activation_reason: 'Test signal'
                }
            }
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        wallet: wallet.publicKey.toString()
    });
});

// Get wallet balance endpoint
// Get wallet holdings endpoint (updated from deprecated balances)
app.get('/balance', async (req, res) => {
    try {
        // Use the new holdings endpoint instead of deprecated balances
        const walletAddress = wallet.publicKey.toString();
        const holdingsResponse = await makeJupiterRequest(`/ultra/v1/holdings/${walletAddress}`);
        
        res.json({
            wallet: walletAddress,
            holdings: holdingsResponse,
            endpoint: 'holdings' // Indicate we're using the new endpoint
        });
    } catch (error) {
        console.error('Error fetching holdings:', error);
        res.status(500).json({
            error: 'Failed to fetch holdings',
            message: error.message,
            note: 'Using new /holdings endpoint (balances is deprecated)'
        });
    }
});

// Test endpoint for manual swap execution
app.post('/test-swap', async (req, res) => {
    try {
        const { inputMint, outputMint, amount, slippageBps } = req.body;
        
        if (!inputMint || !outputMint || !amount) {
            return res.status(400).json({
                error: 'Missing required parameters: inputMint, outputMint, amount'
            });
        }
        
        const orderResponse = await getSwapOrder(inputMint, outputMint, amount, slippageBps);
        
        if (!orderResponse.transaction) {
            throw new Error('No transaction received from Jupiter API');
        }
        
        const signedTransaction = signTransaction(orderResponse.transaction);
        const executeResponse = await executeSwap(signedTransaction, orderResponse.requestId);
        
        res.json({
            success: true,
            orderResponse: {
                inputMint: orderResponse.inputMint,
                outputMint: orderResponse.outputMint,
                inAmount: orderResponse.inAmount,
                outAmount: orderResponse.outAmount,
                slippageBps: orderResponse.slippageBps,
                priceImpactPct: orderResponse.priceImpactPct
            },
            executeResponse
        });
        
    } catch (error) {
        console.error('Test swap error:', error);
        res.status(500).json({
            error: 'Test swap failed',
            message: error.message
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Jupiter webhook server listening on port ${PORT}`);
    console.log(`Wallet address: ${wallet.publicKey.toString()}`);
    console.log(`Jupiter API URL: ${JUPITER_BASE_URL}`);
    console.log(`API Key configured: ${!!JUPITER_API_KEY}`);
    console.log(`Mock Mode: ${MOCK_MODE ? '🧪 ENABLED (safe testing)' : '❌ DISABLED (real transactions)'}`);
    
    if (MOCK_MODE) {
        console.log('\n🧪 MOCK MODE ACTIVE - All transactions are simulated!');
        console.log('Visit http://localhost:' + PORT + '/mock-status for test commands');
    } else if (!JUPITER_API_KEY) {
        console.log('\n⚠️  WARNING: No Jupiter API key configured. You may get 401 errors.');
        console.log('Get a free API key at: https://portal.jup.ag');
        console.log('Or enable mock mode with: MOCK_MODE=true');
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    process.exit(0);
});

module.exports = app;

// Save this file as server.js