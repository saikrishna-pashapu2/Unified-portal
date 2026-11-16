# Database roles and migration ownership

Production uses a separate identity for schema migrations and for each running application. `pnpm db:migrate:deploy` reads `ESG_MIGRATION_DATABASE_URL` and `CREDIT_MIGRATION_DATABASE_URL`; the web and worker processes read only `ESG_DATABASE_URL` and `CREDIT_DATABASE_URL`.

Create roles with your secret-management process, then apply the following template as the database owner. Replace the bracketed identifiers before running it separately in each database.

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE [database_name] TO [app_role];
GRANT USAGE ON SCHEMA public TO [app_role];
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO [app_role];
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO [app_role];

ALTER DEFAULT PRIVILEGES FOR ROLE [migration_role] IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO [app_role];
ALTER DEFAULT PRIVILEGES FOR ROLE [migration_role] IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO [app_role];

REVOKE CREATE ON SCHEMA public FROM [app_role];
REVOKE ALL ON DATABASE [database_name] FROM [app_role];
GRANT CONNECT ON DATABASE [database_name] TO [app_role];
```

The application identity must not own the database, schema, tables, or migrations and must not have `CREATE`, `ALTER`, `DROP`, or role-management privileges. Run migrations as a release step before starting the updated web and worker processes. Never expose migration URLs to either runtime process.
