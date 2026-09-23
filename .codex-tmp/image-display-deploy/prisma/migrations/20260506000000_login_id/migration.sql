ALTER TABLE "users" RENAME COLUMN "email" TO "login_id";

ALTER INDEX "users_email_key" RENAME TO "users_login_id_key";
