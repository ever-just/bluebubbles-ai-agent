# Direct OAuth Implementation (Not Auth0)

## Overview
Implementing OAuth 2.0 directly for Google services authentication without using Auth0 as a middleman.

## Why Direct OAuth?
- Full control over authentication flow
- No third-party service dependency
- Lower cost (no Auth0 fees)
- Direct integration with Google services
- Simpler architecture

## OAuth 2.0 Flow Implementation

### 1. Authorization Code Flow
```typescript
// src/auth/OAuth2Service.ts
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';

export class OAuth2Service {
  private client: OAuth2Client;
  private states: Map<string, StateData> = new Map();
  
  constructor() {
    this.client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.REDIRECT_URI
    );
  }
  
  // Step 1: Generate authorization URL
  generateAuthUrl(userId: string): string {
    const state = crypto.randomBytes(32).toString('hex');
    
    // Store state for verification
    this.states.set(state, {
      userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600000 // 10 minutes
    });
    
    const url = this.client.generateAuthUrl({
      access_type: 'offline',  // Get refresh token
      scope: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ],
      state,
      prompt: 'consent'  // Force consent to get refresh token
    });
    
    return url;
  }
  
  // Step 2: Exchange authorization code for tokens
  async exchangeCodeForTokens(
    code: string, 
    state: string
  ): Promise<TokenResponse> {
    // Verify state
    const stateData = this.states.get(state);
    if (!stateData || stateData.expiresAt < Date.now()) {
      throw new Error('Invalid or expired state');
    }
    
    this.states.delete(state);
    
    // Exchange code for tokens
    const { tokens } = await this.client.getToken(code);
    
    // Get user info
    this.client.setCredentials(tokens);
    const oauth2 = google.oauth2({
      auth: this.client,
      version: 'v2'
    });
    
    const { data: userInfo } = await oauth2.userinfo.get();
    
    return {
      userId: stateData.userId,
      tokens,
      userInfo
    };
  }
  
  // Step 3: Refresh access token
  async refreshAccessToken(refreshToken: string): Promise<Credentials> {
    this.client.setCredentials({
      refresh_token: refreshToken
    });
    
    const { credentials } = await this.client.refreshAccessToken();
    return credentials;
  }
}
```

### 2. Token Storage
```typescript
// src/auth/TokenManager.ts
import { EncryptionService } from '../services/EncryptionService';

export class TokenManager {
  private encryption: EncryptionService;
  private db: Database;
  
  async storeTokens(
    userId: string, 
    tokens: TokenSet
  ): Promise<void> {
    // Encrypt sensitive tokens
    const encrypted = {
      access_token: await this.encryption.encrypt(tokens.access_token),
      refresh_token: await this.encryption.encrypt(tokens.refresh_token),
      expiry_date: tokens.expiry_date,
      scope: tokens.scope,
      token_type: tokens.token_type
    };
    
    await this.db.query(
      `INSERT INTO user_tokens (user_id, provider, tokens, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, provider) 
       DO UPDATE SET tokens = $3, updated_at = NOW()`,
      [userId, 'google', JSON.stringify(encrypted)]
    );
  }
  
  async getTokens(userId: string): Promise<TokenSet | null> {
    const result = await this.db.query(
      'SELECT tokens FROM user_tokens WHERE user_id = $1 AND provider = $2',
      [userId, 'google']
    );
    
    if (!result.rows[0]) return null;
    
    const encrypted = JSON.parse(result.rows[0].tokens);
    
    // Decrypt tokens
    return {
      access_token: await this.encryption.decrypt(encrypted.access_token),
      refresh_token: await this.encryption.decrypt(encrypted.refresh_token),
      expiry_date: encrypted.expiry_date,
      scope: encrypted.scope,
      token_type: encrypted.token_type
    };
  }
  
  async getValidAccessToken(userId: string): Promise<string> {
    const tokens = await this.getTokens(userId);
    if (!tokens) {
      throw new Error('No tokens found for user');
    }
    
    // Check if token is expired (with 5 minute buffer)
    const now = Date.now();
    const expiryWithBuffer = tokens.expiry_date - 300000; // 5 minutes
    
    if (now >= expiryWithBuffer) {
      // Refresh the token
      const newTokens = await this.oauth2Service.refreshAccessToken(
        tokens.refresh_token
      );
      
      // Store updated tokens
      await this.storeTokens(userId, {
        ...tokens,
        ...newTokens
      });
      
      return newTokens.access_token;
    }
    
    return tokens.access_token;
  }
}
```

### 3. Express Routes
```typescript
// src/routes/auth.ts
import { Router } from 'express';
import { OAuth2Service } from '../auth/OAuth2Service';
import { TokenManager } from '../auth/TokenManager';

const router = Router();
const oauth2 = new OAuth2Service();
const tokenManager = new TokenManager();

// Initiate OAuth flow
router.get('/auth/google', (req, res) => {
  const userId = req.session.userId || crypto.randomUUID();
  req.session.userId = userId;
  
  const authUrl = oauth2.generateAuthUrl(userId);
  res.redirect(authUrl);
});

// OAuth callback
router.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  
  if (error) {
    return res.status(400).json({ error: error });
  }
  
  try {
    const { userId, tokens, userInfo } = await oauth2.exchangeCodeForTokens(
      code as string,
      state as string
    );
    
    // Store tokens
    await tokenManager.storeTokens(userId, tokens);
    
    // Create or update user
    await createOrUpdateUser({
      id: userId,
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      googleId: userInfo.id
    });
    
    // Set session
    req.session.userId = userId;
    req.session.authenticated = true;
    
    res.redirect('/dashboard');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Logout
router.post('/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

export default router;
```

### 4. Middleware for Protected Routes
```typescript
// src/middleware/auth.ts
export async function requireAuth(req, res, next) {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // Check if tokens are still valid
  try {
    const token = await tokenManager.getValidAccessToken(req.session.userId);
    req.googleAccessToken = token;
    next();
  } catch (error) {
    // Tokens invalid, need re-authentication
    return res.status(401).json({ 
      error: 'Re-authentication required',
      authUrl: oauth2.generateAuthUrl(req.session.userId)
    });
  }
}
```

## Database Schema for OAuth

```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  picture TEXT,
  google_id VARCHAR(255) UNIQUE,
  phone_number VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- OAuth tokens table
CREATE TABLE user_tokens (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  tokens JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, provider)
);

-- Sessions table (if not using Redis)
CREATE TABLE sessions (
  sid VARCHAR PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP NOT NULL
);

CREATE INDEX idx_sessions_expire ON sessions(expire);
```

## Security Considerations

### 1. Token Encryption
```typescript
// src/services/EncryptionService.ts
import crypto from 'crypto';

export class EncryptionService {
  private algorithm = 'aes-256-gcm';
  private key: Buffer;
  
  constructor() {
    // Use a strong key from environment
    this.key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  }
  
  encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }
  
  decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}
```

### 2. Session Security
```typescript
// src/app.ts
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

const PgSession = connectPgSimple(session);

app.use(session({
  store: new PgSession({
    pool: pgPool,
    tableName: 'sessions'
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'strict'
  }
}));
```

### 3. PKCE for Additional Security (Optional)
```typescript
// For public clients (e.g., mobile apps)
class PKCEFlow {
  generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }
  
  generateCodeChallenge(verifier: string): string {
    return crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');
  }
  
  generateAuthUrlWithPKCE(userId: string): {
    url: string;
    codeVerifier: string;
  } {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    
    const url = this.client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      state: this.generateState(userId),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });
    
    return { url, codeVerifier };
  }
}
```

## Integration with Services

### Gmail Integration with OAuth
```typescript
class GmailService {
  async initialize(userId: string) {
    const accessToken = await tokenManager.getValidAccessToken(userId);
    
    const oauth2Client = new OAuth2Client();
    oauth2Client.setCredentials({
      access_token: accessToken
    });
    
    this.gmail = google.gmail({
      version: 'v1',
      auth: oauth2Client
    });
  }
}
```

### Calendar Integration with OAuth
```typescript
class CalendarService {
  async initialize(userId: string) {
    const accessToken = await tokenManager.getValidAccessToken(userId);
    
    const oauth2Client = new OAuth2Client();
    oauth2Client.setCredentials({
      access_token: accessToken
    });
    
    this.calendar = google.calendar({
      version: 'v3',
      auth: oauth2Client
    });
  }
}
```

## Environment Variables
```bash
# .env
# Google OAuth
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
REDIRECT_URI=http://localhost:3000/auth/google/callback

# Security
ENCRYPTION_KEY=64-character-hex-string
SESSION_SECRET=strong-random-string

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/bluebubbles
```

## Testing OAuth Flow

```typescript
// tests/auth/OAuth2Service.test.ts
describe('OAuth2Service', () => {
  let service: OAuth2Service;
  
  beforeEach(() => {
    service = new OAuth2Service();
  });
  
  test('should generate valid auth URL', () => {
    const url = service.generateAuthUrl('test-user-id');
    
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('client_id=');
    expect(url).toContain('redirect_uri=');
    expect(url).toContain('scope=');
    expect(url).toContain('state=');
  });
  
  test('should validate state correctly', async () => {
    const url = service.generateAuthUrl('test-user-id');
    const state = new URL(url).searchParams.get('state');
    
    // Should not throw
    expect(() => service.validateState(state)).not.toThrow();
  });
});
```

## Benefits Over Auth0
1. **No vendor lock-in** - Direct Google OAuth
2. **Lower cost** - No Auth0 subscription fees
3. **Simpler architecture** - One less service to manage
4. **Full control** - Complete control over auth flow
5. **Direct integration** - No middleman for Google services

## Complexity Assessment
**Moderate Complexity** - More complex than Auth0 but manageable:
- Need to implement token refresh logic
- Must handle token storage securely
- Session management required
- State validation for security
- But: Well-documented Google libraries help significantly
