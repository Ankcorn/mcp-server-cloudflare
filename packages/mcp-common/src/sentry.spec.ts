import { describe, expect, it, vi } from 'vitest'

import { McpError } from './mcp-error'

/**
 * Test that McpError correctly sets reportToSentry based on upstream status.
 * This validates Fix 6: upstream 4xx errors from cloudflare-auth no longer
 * report to Sentry (reportToSentry=false), while genuine 5xx/502 errors still do.
 */
describe('McpError reportToSentry classification', () => {
	it('upstream 400 errors should NOT report to Sentry', () => {
		const err = new McpError('Token refresh failed', 400, {
			reportToSentry: false,
			internalMessage: 'Upstream 400: invalid_grant',
		})
		expect(err.reportToSentry).toBe(false)
	})

	it('upstream 401 errors should NOT report to Sentry', () => {
		const err = new McpError('Invalid client credentials', 401, {
			reportToSentry: false,
			internalMessage: 'Upstream 401: invalid_client',
		})
		expect(err.reportToSentry).toBe(false)
	})

	it('upstream 429 errors should NOT report to Sentry', () => {
		const err = new McpError('Too many requests', 429, {
			reportToSentry: false,
			internalMessage: 'Upstream 429',
		})
		expect(err.reportToSentry).toBe(false)
	})

	it('upstream 502 (bad gateway) errors SHOULD report to Sentry', () => {
		const err = new McpError('Upstream token service unavailable', 502, {
			reportToSentry: true,
			internalMessage: 'Upstream 500: Internal Server Error',
		})
		expect(err.reportToSentry).toBe(true)
	})

	it('account token refresh (400) should NOT report to Sentry', () => {
		const err = new McpError('Account tokens cannot be refreshed', 400, {
			reportToSentry: false,
		})
		expect(err.reportToSentry).toBe(false)
	})

	it('missing refresh token (400) should NOT report to Sentry', () => {
		const err = new McpError('No refresh token available for this grant', 400, {
			reportToSentry: false,
		})
		expect(err.reportToSentry).toBe(false)
	})

	it('preserves internalMessage for debugging', () => {
		const err = new McpError('Token refresh failed', 400, {
			reportToSentry: false,
			internalMessage: 'Upstream 400: {"error":"invalid_grant","error_description":"expired"}',
		})
		expect(err.internalMessage).toContain('invalid_grant')
	})
})
