# Project Context

This is a typescript project using next-app with prisma.

The API has 63 routes. See .codesight/routes.md for the full route map with methods, paths, and tags.
The database has 18 models. See .codesight/schema.md for the full schema with fields, types, and relations.
The UI has 18 components. See .codesight/components.md for the full list with props.
Middleware includes: auth, custom, validation.

High-impact files (most imported, changes here affect many other files):
- lib/analyzers/html-parser.ts (imported by 2 files)
- lib/connectors/meta-ad-library-scraper.ts (imported by 2 files)
- lib/connectors/meta-token.ts (imported by 2 files)
- lib/connectors/meta-ad-library.ts (imported by 1 files)
- lib/db.ts (imported by 1 files)
- lib/skills/loader.ts (imported by 1 files)
- jobs/fetch-blog-content.ts (imported by 1 files)

Required environment variables (no defaults):
- DATAFORSEO_LOGIN (.env.example)
- DATAFORSEO_PASSWORD (.env.example)
- DEEPSEEK_API_KEY (.env.example)
- GA4_PROPERTY_ID (.env.example)
- GA4_SERVICE_ACCOUNT_JSON (.env.example)
- GA4_SERVICE_ACCOUNT_JSON_PATH (.env.example)
- GOOGLE_ADS_API_VERSION (lib/connectors/google-ads.ts)
- GOOGLE_ADS_CLIENT_ID (.env.example)
- GOOGLE_ADS_CLIENT_SECRET (.env.example)
- GOOGLE_ADS_CLIENT_SECRET_JSON_PATH (scripts/google-ads-oauth.mjs)
- GOOGLE_ADS_CUSTOMER_ID (.env.example)
- GOOGLE_ADS_DEVELOPER_TOKEN (.env.example)
- GOOGLE_ADS_OAUTH_CLIENT_JSON_PATH (scripts/google-ads-oauth.mjs)
- GOOGLE_ADS_REFRESH_TOKEN (.env.example)
- GOOGLE_CLIENT_ID (scripts/grant-ga4-access.mjs)

Read .codesight/wiki/index.md for orientation (WHERE things live). Then read actual source files before implementing. Wiki articles are navigation aids, not implementation guides.
Read .codesight/CODESIGHT.md for the complete AI context map including all routes, schema, components, libraries, config, middleware, and dependency graph.
