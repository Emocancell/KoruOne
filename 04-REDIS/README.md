# Redis Engine and Control Plane
Cache: `koru:dashboard:summary`, TTL 30 s, cache-aside, PostgreSQL authoritative. Redis Control API is separately deployed and exposes read-only health. **Detach/Update/Attach, failover, backup/restore and ACL Sync are planned, not implemented.** Never expose Redis directly to the internet. Production requires TLS and dedicated ACL users.
