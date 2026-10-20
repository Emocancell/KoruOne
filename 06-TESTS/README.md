# Verification checklist
- No token -> 401 on /api routes.
- Network role -> department create allowed; salary change 403.
- HR role -> salary update allowed; product price update 403.
- Marketing role -> price update allowed; advertisement publish 403.
- Advertising role -> advertisement publish allowed.
- Authenticated user -> ticket creation allowed.
- Dashboard first read -> postgresql, subsequent read -> redis-hit, after mutation -> postgresql.
- Redis down -> dashboard falls back to PostgreSQL.
- CSV export -> restricted to admin/it/network.
No automated integration suite is included yet; run these before release.
