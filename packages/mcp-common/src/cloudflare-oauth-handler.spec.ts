import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleTokenExchangeCallback } from './cloudflare-oauth-handler'
import { McpError } from './mcp-error'

import type { TokenExchangeCallbackOptions } from '@cloudflare/workers-oauth-provider'

// Mock the refreshAuthToken function
vi.mock('./cloudflare-auth', () => ({
	refreshAuthToken: vi.fn(),
	getAuthToken: vi.fn(),
	generatePKCECodes: vi.fn(),
	getAuthorizationURL: vi.fn(),
}))

// Import the mocked module
import { refreshAuthToken } from './cloudflare-auth'
const mockRefreshAuthToken = vi.mocked(refreshAuthToken)

beforeEach(() => {
	vi.resetAllMocks()
})

afterEach(() => {
	vi.restoreAllMocks()
})

function makeRefreshOptions(
	propsOverride: Record<string, unknown>
): TokenExchangeCallbackOptions {
	return {
		grantType: 'refresh_token',
		props: propsOverride,
		clientId: 'test',
		userId: 'test-user',
		scope: [],
	}
}

describe('handleTokenExchangeCallback', () => {
	const clientId = 'test-client-id'
	const clientSecret = 'test-client-secret'

	describe('account_token refresh attempt', () => {
		it('throws McpError 400 (not 500) for account token refresh', async () => {
			const options = makeRefreshOptions({
				type: 'account_token',
				accessToken: 'test-token',
				account: { name: 'test', id: 'test-id' },
			})

			try {
				await handleTokenExchangeCallback(options, clientId, clientSecret)
				expect.unreachable()
			} catch (e) {
				expect(e).toBeInstanceOf(McpError)
				const err = e as McpError
				expect(err.code).toBe(400)
				expect(err.message).toBe('Account tokens cannot be refreshed')
				expect(err.reportToSentry).toBe(true)
			}
		})
	})

	describe('missing refresh token', () => {
		it('throws McpError 400 (not 500) when refreshToken is missing', async () => {
			const options = makeRefreshOptions({
				type: 'user_token',
				accessToken: 'test-token',
				user: { id: 'user-1', email: 'user@example.com' },
				accounts: [{ name: 'test', id: 'test-id' }],
				// no refreshToken
			})

			try {
				await handleTokenExchangeCallback(options, clientId, clientSecret)
				expect.unreachable()
			} catch (e) {
				expect(e).toBeInstanceOf(McpError)
				const err = e as McpError
				expect(err.code).toBe(400)
				expect(err.message).toBe('No refresh token available for this grant')
				expect(err.reportToSentry).toBe(true)
			}
		})
	})

	describe('successful refresh', () => {
		it('returns new props and TTL on successful refresh', async () => {
			mockRefreshAuthToken.mockResolvedValueOnce({
				access_token: 'new-access-token',
				refresh_token: 'new-refresh-token',
				expires_in: 7200,
				scope: 'read write',
				token_type: 'bearer',
			})

			const options = makeRefreshOptions({
				type: 'user_token',
				accessToken: 'old-access-token',
				refreshToken: 'old-refresh-token',
				user: { id: 'user-1', email: 'user@example.com' },
				accounts: [{ name: 'test', id: 'test-id' }],
			})

			const result = await handleTokenExchangeCallback(options, clientId, clientSecret)
			expect(result).toBeDefined()
			expect(result!.accessTokenTTL).toBe(7200)
			expect(result!.newProps).toMatchObject({
				accessToken: 'new-access-token',
				refreshToken: 'new-refresh-token',
			})
		})
	})

	describe('propagates upstream errors from refreshAuthToken', () => {
		it('propagates McpError 400 from expired upstream refresh token', async () => {
			mockRefreshAuthToken.mockRejectedValueOnce(
				new McpError('The refresh token has expired', 400, {
					reportToSentry: true,
					internalMessage: 'Upstream 400: {"error":"invalid_grant"}',
				})
			)

			const options = makeRefreshOptions({
				type: 'user_token',
				accessToken: 'test-token',
				refreshToken: 'expired-refresh-token',
				user: { id: 'user-1', email: 'user@example.com' },
				accounts: [{ name: 'test', id: 'test-id' }],
			})

			try {
				await handleTokenExchangeCallback(options, clientId, clientSecret)
				expect.unreachable()
			} catch (e) {
				expect(e).toBeInstanceOf(McpError)
				const err = e as McpError
				expect(err.code).toBe(400)
				expect(err.reportToSentry).toBe(true)
			}
		})

		it('propagates McpError 502 from upstream server error', async () => {
			mockRefreshAuthToken.mockRejectedValueOnce(
				new McpError('Upstream token service unavailable', 502, {
					reportToSentry: true,
					internalMessage: 'Upstream 500: Internal Server Error',
				})
			)

			const options = makeRefreshOptions({
				type: 'user_token',
				accessToken: 'test-token',
				refreshToken: 'valid-refresh-token',
				user: { id: 'user-1', email: 'user@example.com' },
				accounts: [{ name: 'test', id: 'test-id' }],
			})

			try {
				await handleTokenExchangeCallback(options, clientId, clientSecret)
				expect.unreachable()
			} catch (e) {
				expect(e).toBeInstanceOf(McpError)
				const err = e as McpError
				expect(err.code).toBe(502)
				expect(err.reportToSentry).toBe(true)
			}
		})
	})

	describe('non-refresh grant types', () => {
		it('returns undefined for authorization_code grant type', async () => {
			const options: TokenExchangeCallbackOptions = {
				grantType: 'authorization_code',
				props: {},
				clientId: 'test',
				userId: 'test-user',
				scope: [],
			}

			const result = await handleTokenExchangeCallback(options, clientId, clientSecret)
			expect(result).toBeUndefined()
		})
	})
})
