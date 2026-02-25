# Phase 1.5 RLS Validation (Manual Test Pack)

This file tracks progress for roadmap section `Phase 1.5: Tenant Isolation Validation`.

## Preconditions
- Supabase project is created and migrations `001`, `002`, `003` are applied.
- At least two institutions exist: `Institution A` and `Institution B`.
- At least one admin user exists in each institution.
- Optional: one `super_admin` user exists in `public.user_profiles`.

## Covered Roadmap Cases (to execute)

### 1.5.1 RLS Testing Suite
- [ ] Admin from Institution A cannot read Institution B data
- [ ] Super admin override works correctly
- [ ] Direct table queries from client are blocked
- [ ] Attempt/answer/result isolation
- [ ] Audit log tenant scoping

### 1.5.2 Security Validation
- [ ] Attempt cross-tenant PIN access
- [ ] Attempt cross-tenant exam access
- [ ] Attempt to fetch correct answers via client API
- [ ] Validate service role is not exposed to client

## Execution
- Use `rls_validation.sql` for SQL/RPC checks (psql or Supabase SQL Editor).
- Record outcomes in this file with date, tester, and evidence links/snippets.

## Result Log
- Date:
- Tester:
- Environment:
- Summary:
- Failures:
- Follow-up fixes:
