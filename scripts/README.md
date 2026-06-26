`scripts/create-user.mjs`
- Creates a login user in `app_users` using the same password hashing as the app.
- Usage: `npm run script:create-user -- --username alice --password secret123 --user-type lab_user`

`scripts/grant-folder-permission.mjs`
- Grants a user access to a blob folder prefix in `folder_permissions`.
- Usage: `npm run script:grant-folder -- --username alice --folder clients/raw_reads/batch-001/sample-a`

Notes
- These commands expect the app `.env` file to contain the database settings and `APP_SESSION_SECRET`.
- `--folder` is normalized to end with `/` automatically.
- `--user-type` defaults to `lab_user`.
