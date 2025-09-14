const express = require('express');
const { Connection, Keypair, Transaction, VersionedTransaction, PublicKey } = require('@solana/web3.js');
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
const NEXGENT_API_KEY = process.env.NEXGENT_API_KEY; // Required for virtual agent balance
const NEXGENT_BASE_URL = process.env.NEXGENT_BASE_URL || 'https://public.api.nexgent.ai';

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

// Check required environment variables
if (!NEXGENT_API_KEY && !MOCK_MODE) {
    console.error('NEXGENT_API_KEY environment variable is required for virtual agent balance checks');
    process.exit(1);
}

// Jupiter API base URLs
const JUPITER_BASE_URL = JUPITER_API_KEY ? 'https://api.jup.ag' : 'https://lite-api.jup.ag';

// Function to make Nexgent API requests
async function makeNexgentRequest(endpoint, method = 'GET', body = null) {
    if (MOCK_MODE) {
        console.log(`🧪 Mock Nexgent API Call: ${method} ${endpoint}`);
        await new Promise(resolve => setTimeout(resolve, 300)); // Simulate network delay
        
        // Mock virtual agent balances
        if (endpoint.includes('/agent/') && endpoint.includes('/wallet/balance')) {
            return {
                balances: [
                    {
                        token: "So11111111111111111111111111111111111111112",
                        symbol: "SOL",
                        balance: 2.5,
                        value_usd: 250.0
                    },
                    {
                        token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 
                        symbol: "USDC",
                        balance: 1200.0, // Virtual agent thinks it has 1200 USDC
                        value_usd: 1200.0
                    },
                    {
                        token: "mockTokenMint123",
                        symbol: "MOCK",
                        balance: 800.0, // Virtual agent thinks it has 800 tokens
                        value_usd: 400.0
                    }
                ],
                total_value_usd: 1850.0,
                mockData: true
            };
        }
        
        throw new Error(`Mock Nexgent API: Unhandled endpoint ${endpoint}`);
    }

    // Real API call
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NEXGENT_API_KEY}`
    };
    
    const config = {
        method,
        headers,
    };
    
    if (body && method !== 'GET') {
        config.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${NEXGENT_BASE_URL}${endpoint}`, config);
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Nexgent API error: ${response.status} - ${errorText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Nexgent API request failed:', error);
        throw error;
    }
}

// Function to get virtual agent's wallet balance
async function getVirtualAgentBalance(agentId) {
    try {
        console.log(`🔍 Fetching virtual balance for agent: ${agentId}`);
        const response = await makeNexgentRequest(`/agent/${agentId}/wallet/balance`);
        
        console.log('📊 Virtual agent balances:', {
            totalValue: response.total_value_usd,
            tokenCount: response.balances.length,
            balances: response.balances.map(b => ({ symbol: b.symbol, balance: b.balance }))
        });
        
        return response;
    } catch (error) {
        console.error('Error fetching virtual agent balance:', error);
        throw error;
    }
}

// Function to find virtual balance for specific token
function findVirtualTokenBalance(virtualBalances, tokenMint, tokenSymbol) {
    // Try to find by token mint address first
    let virtualToken = virtualBalances.balances?.find(b => b.token === tokenMint);
    
    // Fallback to symbol match if mint not found
    if (!virtualToken && tokenSymbol) {
        virtualToken = virtualBalances.balances?.find(b => b.symbol.toLowerCase() === tokenSymbol.toLowerCase());
    }
    
    return virtualToken ? virtualToken.balance : 0;
}

// Function to make Jupiter API requests
async function makeJupiterRequest(endpoint, method = 'GET', body = null) {
    if (MOCK_MODE) {
        console.log(`🧪 Mock Jupiter API Call: ${method} ${endpoint}`);
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
        
        if (endpoint.includes('/ultra/v1/holdings/')) {
            return {
                holdings: [
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
                        amount: "1000000000", // 1000 USDC (less than virtual's 1200)
                        decimals: 6,
                        uiAmount: 1000.0
                    },
                    {
                        mint: "mockTokenMint123",
                        symbol: "MOCK",
                        amount: "750000000", // 750 tokens (less than virtual's 800)
                        decimals: 6,
                        uiAmount: 750.0
                    }
                ],
                mockData: true
            };
        }
        
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
        
        throw new Error(`Mock Jupiter API: Unhandled endpoint ${endpoint}`);
    }

    // Real Jupiter API code
    const headers = {
        'Content-Type': 'application/json',
    };
    
    if (JUPITER_API_KEY) {
        headers['X-API-Key'] = JUPITER_API_KEY;
        console.log('🔑 Using Jupiter API Key');
    }

    const config = {
        method,
        headers,
    };
    
    if (body && method !== 'GET') {
        config.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${JUPITER_BASE_URL}${endpoint}`, config);
        
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

// Function to get actual wallet balance for a specific token
async function getActualTokenBalance(tokenMint) {
    try {
        const walletAddress = wallet.publicKey.toString();
        console.log(`🔍 Fetching actual balance for token: ${tokenMint}`);
        
        const holdingsResponse = await makeJupiterRequest(`/ultra/v1/holdings/${walletAddress}`);
        
        // Find the specific token in holdings
        const tokenHolding = holdingsResponse.holdings?.find(holding => holding.mint === tokenMint);
        
        if (!tokenHolding) {
            console.log(`⚠️ Token ${tokenMint} not found in wallet holdings`);
            return {
                amount: "0",
                uiAmount: 0,
                decimals: await getTokenDecimals(tokenMint),
                found: false
            };
        }
        
        console.log(`✅ Found actual token balance:`, {
            symbol: tokenHolding.symbol,
            amount: tokenHolding.amount,
            uiAmount: tokenHolding.uiAmount,
            decimals: tokenHolding.decimals
        });
        
        return {
            amount: tokenHolding.amount,
            uiAmount: tokenHolding.uiAmount,
            decimals: tokenHolding.decimals,
            symbol: tokenHolding.symbol,
            found: true
        };
    } catch (error) {
        console.error('Error fetching actual token balance:', error);
        throw error;
    }
}

// Function to get token decimals dynamically
async function getTokenDecimals(tokenMint) {
    try {
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
    
    try {
        console.log('🔄 Querying Solana RPC for mint info...');
        const connection = new Connection('https://api.mainnet-beta.solana.com');
        
        const mintInfo = await connection.getParsedAccountInfo(new PublicKey(tokenMint));
        if (mintInfo.value && mintInfo.value.data.parsed) {
            const decimals = mintInfo.value.data.parsed.info.decimals;
            console.log(`✅ Got decimals from Solana RPC: ${decimals}`);
            return decimals;
        }
    } catch (error) {
        console.log('⚠️ Solana RPC failed:', error.message);
    }
    
    console.log('⚠️ Using default 6 decimals');
    return 6;
}

// Function to determine if this is an exit transaction (selling tokens for SOL)
function isExitTransaction(inputMint, outputMint) {
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    return outputMint === SOL_MINT && inputMint !== SOL_MINT;
}

// Function to calculate exit percentage and amount based on virtual agent balance
async function calculateExitStrategy(webhookAmount, tokenMint, tokenSymbol, agentId) {
    try {
        console.log(`📊 Calculating exit strategy for ${tokenSymbol}`);
        console.log(`   Webhook amount: ${webhookAmount}`);
        
        // Get virtual agent's current balance
        const virtualBalances = await getVirtualAgentBalance(agentId);
        const virtualBalance = findVirtualTokenBalance(virtualBalances, tokenMint, tokenSymbol);
        
        console.log(`📈 Virtual agent balance analysis:`, {
            tokenMint: tokenMint,
            tokenSymbol: tokenSymbol,
            virtualBalance: virtualBalance,
            webhookAmount: webhookAmount
        });
        
        // Get actual wallet balance
        const actualBalance = await getActualTokenBalance(tokenMint);
        
        if (!actualBalance.found || actualBalance.uiAmount === 0) {
            console.log('❌ No actual balance found, cannot execute exit');
            throw new Error(`No balance found for token ${tokenMint} in actual wallet`);
        }
        
        let exitStrategy;
        let percentageToSell;
        let amountToSell;
        
        if (virtualBalance === 0) {
            // Virtual agent has zero balance - exit full position
            exitStrategy = 'FULL_EXIT_ZERO_VIRTUAL';
            percentageToSell = 1.0;
            amountToSell = actualBalance.uiAmount;
            
            console.log('🚨 Virtual balance is zero - executing FULL EXIT of actual position');
            
        } else if (webhookAmount >= virtualBalance) {
            // Virtual agent wants to sell everything or more than it has
            exitStrategy = 'FULL_EXIT_COMPLETE';
            percentageToSell = 1.0;
            amountToSell = actualBalance.uiAmount;
            
            console.log('🚨 Webhook amount >= virtual balance - executing FULL EXIT');
            
        } else {
            // Partial exit - calculate percentage based on virtual agent's intent
            // The virtual agent has virtualBalance and wants to sell webhookAmount
            // This represents (webhookAmount / virtualBalance) percentage of position
            percentageToSell = webhookAmount / virtualBalance;
            amountToSell = actualBalance.uiAmount * percentageToSell;
            exitStrategy = 'PARTIAL_EXIT';
            
            console.log(`📊 Partial exit calculated:`, {
                virtualBalance: virtualBalance,
                webhookAmount: webhookAmount,
                percentageOfVirtual: `${(percentageToSell * 100).toFixed(2)}%`,
                actualBalance: actualBalance.uiAmount,
                amountToSell: amountToSell
            });
        }
        
        // Convert to lamports for Jupiter API
        const amountInLamports = Math.floor(amountToSell * Math.pow(10, actualBalance.decimals));
        
        console.log(`💰 Exit strategy determined: ${exitStrategy}`, {
            percentageToSell: `${(percentageToSell * 100).toFixed(2)}%`,
            amountToSellUI: amountToSell,
            amountInLamports: amountInLamports,
            actualBalance: actualBalance.uiAmount,
            virtualBalance: virtualBalance
        });
        
        return {
            success: true,
            strategy: exitStrategy,
            percentageToSell: percentageToSell,
            amountToSellUI: amountToSell,
            amountInLamports: amountInLamports,
            actualBalance: actualBalance.uiAmount,
            virtualBalance: virtualBalance,
            webhookAmount: webhookAmount,
            willSellAll: percentageToSell >= 0.99
        };
        
    } catch (error) {
        console.error('Error calculating exit strategy:', error);
        return {
            success: false,
            error: error.message
        };
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
function signTransaction(transactionBase64) {
    try {
        const transactionBuffer = Buffer.from(transactionBase64, 'base64');
        
        // Try versioned transaction first (Jupiter Ultra API uses these)
        try {
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

// Main function to process agent transaction with virtual balance sync
async function processAgentTransaction(eventData) {
    const { agentId, data } = eventData;
    
    console.log('🔄 Processing agent transaction:', {
        id: data.id,
        agentId: agentId,
        transaction_type: data.transaction_type,
        input_symbol: data.input_symbol,
        output_symbol: data.output_symbol,
        input_amount: data.input_amount,
        input_mint: data.input_mint,
        output_mint: data.output_mint
    });
    
    try {
        // Check if this is an exit transaction (selling tokens for SOL)
        const isExit = isExitTransaction(data.input_mint, data.output_mint);
        
        // Dynamically fetch token decimals
        console.log('🔍 Fetching token decimals...');
        const inputDecimals = await getTokenDecimals(data.input_mint);
        console.log(`💰 Token ${data.input_symbol} (${data.input_mint}) has ${inputDecimals} decimals`);
        
        let inputAmountLamports;
        let exitStrategy = null;
        
        if (isExit) {
            console.log('🚪 EXIT TRANSACTION DETECTED - Syncing with virtual agent balance');
            
            // Calculate exit strategy based on virtual agent balance
            const exitCalculation = await calculateExitStrategy(
                data.input_amount,
                data.input_mint,
                data.input_symbol,
                agentId
            );
            
            if (!exitCalculation.success) {
                return {
                    success: false,
                    transactionId: data.id,
                    error: `Exit strategy calculation failed: ${exitCalculation.error}`,
                    isExit: true
                };
            }
            
            inputAmountLamports = exitCalculation.amountInLamports;
            exitStrategy = exitCalculation;
            
            console.log('📊 EXIT STRATEGY APPLIED:', {
                strategy: exitCalculation.strategy,
                virtualBalance: exitCalculation.virtualBalance,
                actualBalance: exitCalculation.actualBalance,
                webhookAmount: exitCalculation.webhookAmount,
                percentageToSell: `${(exitCalculation.percentageToSell * 100).toFixed(2)}%`,
                amountToSell: exitCalculation.amountToSellUI,
                willSellAll: exitCalculation.willSellAll
            });
            
        } else {
            // Regular transaction (entry) - use webhook amount as-is
            inputAmountLamports = Math.floor(data.input_amount * Math.pow(10, inputDecimals));
            
            console.log('💱 ENTRY TRANSACTION:', {
                originalAmount: data.input_amount,
                decimals: inputDecimals,
                convertedAmount: inputAmountLamports,
                symbol: data.input_symbol
            });
        }
        
        // Set slippage based on transaction type and direction
        let slippageBps;
        const isSellingToSOL = data.output_mint === 'So11111111111111111111111111111111111111112';
        const isPumpFunToken = data.input_mint.endsWith('pump') || data.input_symbol.toLowerCase().includes('pump');

        if (isSellingToSOL) {
            // Higher slippage for selling tokens (especially exits)
            if (isPumpFunToken) {
                slippageBps = 1000; // 10% for pump.fun token sales
            } else if (isExit) {
                slippageBps = 800;  // 8% for exit transactions
            } else {
                slippageBps = 500;  // 5% for regular token sales
            }
        } else {
            // Lower slippage for buying tokens with SOL  
            slippageBps = data.slippage ? Math.floor(data.slippage * 10000) : 300; // 3%
        }

        console.log(`📊 Slippage strategy:`, {
            direction: isSellingToSOL ? 'SELL → SOL' : 'BUY with SOL',
            isExit: isExit,
            isPumpFun: isPumpFunToken,
            slippageBps: slippageBps,
            slippagePercent: `${slippageBps/100}%`
        });
        
        // Get swap order from Jupiter
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
                isExit: isExit,
                details: {
                    inputAmount: data.input_amount,
                    convertedAmount: inputAmountLamports,
                    decimals: inputDecimals,
                    priceImpact: orderResponse.priceImpactPct,
                    hasRoute: !!orderResponse.routePlan,
                    exitStrategy: exitStrategy
                }
            };
        }
        
        // Sign and execute transaction
        const signedTransaction = signTransaction(orderResponse.transaction);
        const executeResponse = await executeSwap(signedTransaction, orderResponse.requestId);
        
        // Prepare result
        const result = {
            success: true,
            transactionId: data.id,
            isExit: isExit,
            jupiterRequestId: orderResponse.requestId,
            executionStatus: executeResponse.status,
            signature: executeResponse.signature,
            inputAmount: orderResponse.inAmount,
            outputAmount: orderResponse.outAmount,
            priceImpact: orderResponse.priceImpactPct,
            decimalsUsed: inputDecimals
        };
        
        // Add exit strategy info for exit transactions
        if (isExit && exitStrategy) {
            result.exitStrategyInfo = {
                strategy: exitStrategy.strategy,
                virtualBalance: exitStrategy.virtualBalance,
                actualBalance: exitStrategy.actualBalance,
                webhookAmount: exitStrategy.webhookAmount,
                percentageSold: `${(exitStrategy.percentageToSell * 100).toFixed(2)}%`,
                amountSold: exitStrategy.amountToSellUI,
                soldAll: exitStrategy.willSellAll
            };
        }
        
        return result;
        
    } catch (error) {
        console.error('❌ Error processing agent transaction:', error);
        return {
            success: false,
            transactionId: data.id,
            isExit: isExitTransaction(data.input_mint, data.output_mint),
            error: error.message,
            agentId: agentId
        };
    }
}

// Function to process trade signal event
async function processTradeSignal(eventData) {
    const { agentId, data } = eventData;
    
    console.log('🔄 Processing trade signal:', {
        id: data.id,
        agentId: agentId,
        token_symbol: data.token_symbol,
        token_address: data.token_address,
        price_at_signal: data.price_at_signal,
        activation_reason: data.activation_reason
    });
    
    // Default trade amount (configurable)
    const SOL_TRADE_AMOUNT = 0.1; // 0.1 SOL
    const inputAmountLamports = Math.floor(SOL_TRADE_AMOUNT * Math.pow(10, 9));
    
    const inputMint = 'So11111111111111111111111111111111111111112'; // SOL
    const outputMint = data.token_address;
    const slippageBps = 100; // 1% slippage for trade signals
    
    try {
        const orderResponse = await getSwapOrder(
            inputMint,
            outputMint,
            inputAmountLamports,
            slippageBps
        );
        
        if (!orderResponse.transaction) {
            throw new Error('No transaction received from Jupiter API');
        }
        
        const signedTransaction = signTransaction(orderResponse.transaction);
        const executeResponse = await executeSwap(signedTransaction, orderResponse.requestId);
        
        return {
            success: true,
            signalId: data.id,
            agentId: agentId,
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
        console.error('❌ Error processing trade signal:', error);
        return {
            success: false,
            signalId: data.id,
            agentId: agentId,
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
        
        console.log(`\n🎯 ===============================`);
        console.log(`📨 Webhook Event Received`);
        console.log(`   Event: ${event}`);
        console.log(`   Timestamp: ${timestamp}`);
        console.log(`   Agent ID: ${agentId}`);
        console.log(`   Data ID: ${data?.id}`);
        console.log(`🎯 ===============================\n`);
        
        if (!agentId) {
            return res.status(400).json({
                success: false,
                error: 'agentId is required for virtual balance synchronization'
            });
        }
        
        let result;
        
        switch (event) {
            case 'agentTransactions':
                result = await processAgentTransaction({ event, timestamp, agentId, data });
                break;
            
            case 'tradeSignals':
                result = await processTradeSignal({ event, timestamp, agentId, data });
                break;
            
            default:
                console.log(`❌ Unknown event type: ${event}`);
                return res.status(400).json({
                    success: false,
                    error: `Unknown event type: ${event}`
                });
        }
        
        // Log the result
        console.log('\n📊 ===============================');
        console.log('✅ Webhook Processing Complete');
        console.log('📊 ===============================');
        console.log('Result:', JSON.stringify(result, null, 2));
        console.log('📊 ===============================\n');
        
        // Respond with the result
        res.status(200).json({
            success: true,
            event,
            timestamp,
            agentId,
            result
        });
        
    } catch (error) {
        console.error('❌ Webhook processing error:', error);
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
        name: 'Jupiter Webhook Server with Virtual Balance Sync',
        status: 'running',
        timestamp: new Date().toISOString(),
        wallet: wallet.publicKey.toString(),
        features: [
            'Virtual agent balance synchronization',
            'Intelligent exit percentage calculation', 
            'Full position exits when virtual balance is zero',
            'Partial exits based on virtual agent intent'
        ],
        endpoints: {
            'GET /': 'Server information and available endpoints',
            'GET /health': 'Health check endpoint',
            'GET /balance': 'Get actual wallet token balances',
            'GET /virtual-balance/:agentId': 'Get virtual agent balance',
            'GET /balance-comparison/:agentId': 'Compare virtual vs actual balances',
            'POST /webhook': 'Main webhook endpoint for processing events',
            'POST /test-swap': 'Test swap endpoint',
            'POST /test-exit': 'Test exit strategy calculation'
        },
        sampleWebhookPayload: {
            agentTransactions: {
                event: 'agentTransactions',
                timestamp: '2024-01-01T12:00:00.000Z',
                agentId: 'agent-uuid-required',
                data: {
                    id: 456,
                    transaction_type: 'swap',
                    input_mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    input_symbol: 'USDC',
                    input_amount: 500,
                    output_mint: 'So11111111111111111111111111111111111111112',
                    output_symbol: 'SOL',
                    slippage: 0.005
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
        wallet: wallet.publicKey.toString(),
        nexgentApi: !!NEXGENT_API_KEY,
        jupiterApi: !!JUPITER_API_KEY,
        mockMode: MOCK_MODE
    });
});

// Get actual wallet balance endpoint
app.get('/balance', async (req, res) => {
    try {
        const walletAddress = wallet.publicKey.toString();
        const holdingsResponse = await makeJupiterRequest(`/ultra/v1/holdings/${walletAddress}`);
        
        res.json({
            wallet: walletAddress,
            holdings: holdingsResponse.holdings || holdingsResponse,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching actual balance:', error);
        res.status(500).json({
            error: 'Failed to fetch actual wallet balance',
            message: error.message
        });
    }
});

// Get virtual agent balance endpoint
app.get('/virtual-balance/:agentId', async (req, res) => {
    try {
        const { agentId } = req.params;
        const virtualBalances = await getVirtualAgentBalance(agentId);
        
        res.json({
            agentId: agentId,
            virtualBalances: virtualBalances,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching virtual balance:', error);
        res.status(500).json({
            error: 'Failed to fetch virtual agent balance',
            message: error.message
        });
    }
});

// Compare virtual vs actual balances
app.get('/balance-comparison/:agentId', async (req, res) => {
    try {
        const { agentId } = req.params;
        
        // Get both virtual and actual balances
        const [virtualBalances, actualHoldings] = await Promise.all([
            getVirtualAgentBalance(agentId),
            makeJupiterRequest(`/ultra/v1/holdings/${wallet.publicKey.toString()}`)
        ]);
        
        const actualBalances = actualHoldings.holdings || [];
        
        // Compare balances
        const comparison = virtualBalances.balances.map(virtualToken => {
            const actualToken = actualBalances.find(actual => 
                actual.mint === virtualToken.token || 
                actual.symbol?.toLowerCase() === virtualToken.symbol?.toLowerCase()
            );
            
            const actualAmount = actualToken ? actualToken.uiAmount : 0;
            const difference = actualAmount - virtualToken.balance;
            const diffPercent = virtualToken.balance > 0 ? 
                ((difference / virtualToken.balance) * 100).toFixed(2) : 
                (actualAmount > 0 ? '∞' : '0');
            
            return {
                symbol: virtualToken.symbol,
                token: virtualToken.token,
                virtual: virtualToken.balance,
                actual: actualAmount,
                difference: difference,
                diffPercent: diffPercent + '%',
                status: Math.abs(difference) < 0.001 ? 'MATCHED' : 
                        difference > 0 ? 'ACTUAL_HIGHER' : 'VIRTUAL_HIGHER'
            };
        });
        
        res.json({
            agentId: agentId,
            timestamp: new Date().toISOString(),
            comparison: comparison,
            summary: {
                totalTokens: comparison.length,
                matched: comparison.filter(c => c.status === 'MATCHED').length,
                actualHigher: comparison.filter(c => c.status === 'ACTUAL_HIGHER').length,
                virtualHigher: comparison.filter(c => c.status === 'VIRTUAL_HIGHER').length
            }
        });
        
    } catch (error) {
        console.error('Error comparing balances:', error);
        res.status(500).json({
            error: 'Failed to compare balances',
            message: error.message
        });
    }
});

// Test exit strategy calculation
app.post('/test-exit', async (req, res) => {
    try {
        const { agentId, tokenMint, tokenSymbol, webhookAmount } = req.body;
        
        if (!agentId || !tokenMint || !webhookAmount) {
            return res.status(400).json({
                error: 'Missing required parameters: agentId, tokenMint, webhookAmount'
            });
        }
        
        const exitStrategy = await calculateExitStrategy(
            webhookAmount,
            tokenMint,
            tokenSymbol,
            agentId
        );
        
        res.json({
            testParameters: {
                agentId,
                tokenMint,
                tokenSymbol,
                webhookAmount
            },
            exitStrategy: exitStrategy,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Test exit strategy error:', error);
        res.status(500).json({
            error: 'Test exit strategy failed',
            message: error.message
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
    console.log(`\n🚀 ===============================`);
    console.log(`📡 Jupiter Webhook Server Started`);
    console.log(`🚀 ===============================`);
    console.log(`Port: ${PORT}`);
    console.log(`Wallet: ${wallet.publicKey.toString()}`);
    console.log(`Jupiter API: ${JUPITER_BASE_URL}`);
    console.log(`Nexgent API: ${NEXGENT_BASE_URL}`);
    console.log(`Jupiter API Key: ${JUPITER_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`Nexgent API Key: ${NEXGENT_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`Mock Mode: ${MOCK_MODE ? '🧪 ENABLED (safe testing)' : '⚡ DISABLED (real transactions)'}`);
    console.log(`🚀 ===============================`);
    
    if (MOCK_MODE) {
        console.log('\n🧪 MOCK MODE ACTIVE - All transactions are simulated!');
        console.log('• Virtual agent balance calls are mocked');
        console.log('• Jupiter API calls are mocked');
        console.log('• No real transactions will be executed');
        console.log(`• Visit http://localhost:${PORT} for testing endpoints`);
    } else {
        console.log('\n⚡ LIVE MODE ACTIVE');
        console.log('• Real virtual agent balance integration');
        console.log('• Real Jupiter API transactions');  
        console.log('• Transactions will be executed on-chain');
        
        if (!NEXGENT_API_KEY) {
            console.log('\n❌ WARNING: NEXGENT_API_KEY not configured!');
            console.log('• Virtual balance sync will not work');
            console.log('• Enable mock mode with: MOCK_MODE=true');
        }
        
        if (!JUPITER_API_KEY) {
            console.log('\n⚠️  WARNING: No Jupiter API key configured');
            console.log('• You may encounter rate limits');
            console.log('• Get a free API key at: https://portal.jup.ag');
        }
    }
    
    console.log(`\n🎯 Ready to process webhooks with virtual balance synchronization!`);
    console.log(`🎯 ===============================\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    process.exit(0);
});

module.exports = app;