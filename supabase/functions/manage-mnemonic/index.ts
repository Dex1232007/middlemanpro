import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { mnemonicToWalletKey } from 'npm:@ton/crypto@3.3.0'
import { WalletContractV4 } from 'npm:@ton/ton@16.1.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ERROR_MESSAGES = {
  UNAUTHORIZED: 'Unauthorized access',
  NOT_ADMIN: 'Admin privileges required',
  INVALID_MNEMONIC: 'Invalid mnemonic format. Must be 24 words.',
  OPERATION_FAILED: 'Operation failed. Please try again.',
  ENCRYPTION_FAILED: 'Encryption operation failed.',
}

// AES-GCM encryption using Web Crypto API
async function encryptMnemonic(mnemonic: string, password: string): Promise<string> {
  const encoder = new TextEncoder()
  
  // Generate random salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  
  // Derive key using PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )
  
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )
  
  // Encrypt with AES-GCM
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encoder.encode(mnemonic)
  )
  
  // Combine salt + iv + ciphertext
  const encryptedArray = new Uint8Array(encrypted)
  const result = new Uint8Array(salt.length + iv.length + encryptedArray.length)
  result.set(salt, 0)
  result.set(iv, salt.length)
  result.set(encryptedArray, salt.length + iv.length)
  
  // Return as base64
  return btoa(String.fromCharCode(...result))
}

async function decryptMnemonic(encryptedBase64: string, password: string): Promise<string> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  
  // Decode base64
  const combined = new Uint8Array(atob(encryptedBase64).split('').map(c => c.charCodeAt(0)))
  
  // Extract salt, iv, and ciphertext
  const salt = combined.slice(0, 16)
  const iv = combined.slice(16, 28)
  const ciphertext = combined.slice(28)
  
  // Derive key using PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )
  
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )
  
  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    ciphertext
  )
  
  return decoder.decode(decrypted)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    // Get the authorization header
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.UNAUTHORIZED }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Create Supabase client with user's token
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.UNAUTHORIZED }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Check if user is admin using service role client
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)
    
    const { data: roleData, error: roleError } = await adminSupabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle()

    if (roleError || !roleData) {
      console.warn('Non-admin user attempted to manage mnemonic:', user.id)
      return new Response(
        JSON.stringify({ error: ERROR_MESSAGES.NOT_ADMIN }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      )
    }

    // Get request body
    const body = await req.json()
    const { mnemonic, action, destinationWallet, amount, comment } = body

    // Handle different actions
    if (action === 'get') {
      // Get masked mnemonic status
      const { data: setting } = await adminSupabase
        .from('settings')
        .select('value')
        .eq('key', 'ton_mnemonic_encrypted')
        .maybeSingle()
      
      const isConfigured = !!setting?.value
      
      return new Response(
        JSON.stringify({ 
          success: true,
          isConfigured,
          maskedMnemonic: isConfigured ? '●●●● ●●●● ●●●● ●●●● ●●●● ●●●● (24 words)' : null
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'verify' || action === 'get_balance') {
      // Get encrypted mnemonic and derive wallet address
      const { data: setting } = await adminSupabase
        .from('settings')
        .select('value')
        .eq('key', 'ton_mnemonic_encrypted')
        .maybeSingle()
      
      if (!setting?.value) {
        return new Response(
          JSON.stringify({ success: false, error: 'Mnemonic not configured' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      try {
        // Decrypt mnemonic
        const encryptionKey = serviceRoleKey.substring(0, 64)
        const decryptedMnemonic = await decryptMnemonic(setting.value, encryptionKey)
        const words = decryptedMnemonic.split(' ')
        
        // Derive wallet address
        const keyPair = await mnemonicToWalletKey(words)
        const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 })
        const walletAddress = wallet.address.toString({ bounceable: false })
        
        // If getting balance, also fetch it from TON API
        let balance = 0
        if (action === 'get_balance') {
          const TONCENTER_API_KEY = Deno.env.get('TONCENTER_API_KEY') || ''
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          if (TONCENTER_API_KEY) {
            headers['X-API-Key'] = TONCENTER_API_KEY
          }
          
          const balanceUrl = `https://toncenter.com/api/v2/getAddressBalance?address=${encodeURIComponent(walletAddress)}`
          const balanceRes = await fetch(balanceUrl, { headers })
          const balanceData = await balanceRes.json()
          
          if (balanceData?.ok && typeof balanceData.result === 'string') {
            balance = parseInt(balanceData.result, 10) / 1e9
          }
        }
        
        return new Response(
          JSON.stringify({ 
            success: true,
            walletAddress,
            balance,
            message: action === 'get_balance' ? 'Balance fetched successfully' : 'Mnemonic verified successfully'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (verifyError) {
        console.error('Verify error:', verifyError)
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to verify mnemonic' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }
    }
    
    if (action === 'transfer') {
      // Use parameters already parsed from body above
      
      if (!destinationWallet || !amount || amount <= 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid destination wallet or amount' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }
      
      // Get encrypted mnemonic
      const { data: setting } = await adminSupabase
        .from('settings')
        .select('value')
        .eq('key', 'ton_mnemonic_encrypted')
        .maybeSingle()
      
      if (!setting?.value) {
        return new Response(
          JSON.stringify({ success: false, error: 'Mnemonic not configured' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }
      
      try {
        // Import TON libraries
        const tonCore = await import('https://esm.sh/@ton/ton@16.1.0?bundle')
        
        // Decrypt mnemonic
        const encryptionKey = serviceRoleKey.substring(0, 64)
        const decryptedMnemonic = await decryptMnemonic(setting.value, encryptionKey)
        const words = decryptedMnemonic.split(' ')
        
        // Derive wallet
        const keyPair = await mnemonicToWalletKey(words)
        const wallet = tonCore.WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 })
        const walletAddress = wallet.address.toString({ bounceable: false })
        
        // Get wallet balance first
        const TONCENTER_API_KEY = Deno.env.get('TONCENTER_API_KEY') || ''
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (TONCENTER_API_KEY) {
          headers['X-API-Key'] = TONCENTER_API_KEY
        }
        
        const balanceUrl = `https://toncenter.com/api/v2/getAddressBalance?address=${encodeURIComponent(walletAddress)}`
        const balanceRes = await fetch(balanceUrl, { headers })
        const balanceData = await balanceRes.json()
        
        let currentBalance = 0
        if (balanceData?.ok && typeof balanceData.result === 'string') {
          currentBalance = parseInt(balanceData.result, 10) / 1e9
        }
        
        // Check balance
        if (currentBalance < amount + 0.05) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: `Insufficient balance: ${currentBalance.toFixed(4)} TON < ${(amount + 0.05).toFixed(4)} TON (including fees)` 
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          )
        }
        
        // Create client and send transfer
        const endpoint = TONCENTER_API_KEY
          ? `https://toncenter.com/api/v2/jsonRPC?api_key=${TONCENTER_API_KEY}`
          : 'https://toncenter.com/api/v2/jsonRPC'
        
        const client = new tonCore.TonClient({ endpoint })
        const walletContract = client.open(wallet)
        
        const seqno = await walletContract.getSeqno()
        console.log(`Manual transfer: ${amount} TON to ${destinationWallet}, seqno: ${seqno}`)
        
        const amountNano = BigInt(Math.floor(amount * 1e9))
        await walletContract.sendTransfer({
          secretKey: keyPair.secretKey,
          seqno,
          messages: [
            tonCore.internal({
              to: destinationWallet,
              value: amountNano,
              body: comment || 'Admin Transfer',
              bounce: false,
            }),
          ],
        })
        
        const txRef = `manual_${Date.now()}`
        console.log(`✅ Manual transfer sent: ${txRef}`)
        
        return new Response(
          JSON.stringify({ 
            success: true,
            txRef,
            fromWallet: walletAddress,
            toWallet: destinationWallet,
            amount,
            message: `${amount} TON ပေးပို့ပြီးပါပြီ`
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (transferError) {
        console.error('Transfer error:', transferError)
        return new Response(
          JSON.stringify({ success: false, error: `Transfer failed: ${String(transferError)}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }
    }

    if (action === 'set') {
      // Validate mnemonic format (should be 24 words)
      if (!mnemonic || typeof mnemonic !== 'string') {
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.INVALID_MNEMONIC }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      const words = mnemonic.trim().toLowerCase().split(/\s+/)
      if (words.length !== 24) {
        return new Response(
          JSON.stringify({ error: `Invalid mnemonic: expected 24 words, got ${words.length}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      try {
        // Encrypt the mnemonic with AES-GCM
        const encryptionKey = serviceRoleKey.substring(0, 64) // Use longer key for better security
        const encryptedMnemonic = await encryptMnemonic(words.join(' '), encryptionKey)

        // Store encrypted mnemonic
        const { error: upsertError } = await adminSupabase
          .from('settings')
          .upsert({
            key: 'ton_mnemonic_encrypted',
            value: encryptedMnemonic,
            description: 'AES-GCM encrypted TON wallet mnemonic (24 words)'
          }, { onConflict: 'key' })

        if (upsertError) {
          console.error('Failed to store mnemonic:', upsertError)
          return new Response(
            JSON.stringify({ error: ERROR_MESSAGES.OPERATION_FAILED }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
          )
        }

        console.log('Mnemonic updated by admin:', user.id)

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Mnemonic saved successfully',
            warning: '⚠️ Keep your mnemonic safe! Anyone with access to this key can control the wallet.'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      } catch (encryptError) {
        console.error('Encryption error:', encryptError)
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.ENCRYPTION_FAILED }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }
    }

    if (action === 'delete') {
      // Delete the mnemonic
      const { error: deleteError } = await adminSupabase
        .from('settings')
        .delete()
        .eq('key', 'ton_mnemonic_encrypted')

      if (deleteError) {
        console.error('Failed to delete mnemonic:', deleteError)
        return new Response(
          JSON.stringify({ error: ERROR_MESSAGES.OPERATION_FAILED }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }

      console.log('Mnemonic deleted by admin:', user.id)

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Mnemonic deleted successfully'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  } catch (error: unknown) {
    console.error('Mnemonic management error:', error)
    return new Response(
      JSON.stringify({ error: ERROR_MESSAGES.OPERATION_FAILED }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
