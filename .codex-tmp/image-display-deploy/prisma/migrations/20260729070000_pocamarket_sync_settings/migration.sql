CREATE TABLE "pocamarket_sync_settings" (
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "scheduled_hour" INTEGER NOT NULL DEFAULT 3,
    "scheduled_minute" INTEGER NOT NULL DEFAULT 0,
    "speed_profile" TEXT NOT NULL DEFAULT 'BALANCED',
    "last_scheduled_date" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pocamarket_sync_settings_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "pocamarket_sync_settings_hour_check" CHECK ("scheduled_hour" BETWEEN 0 AND 23),
    CONSTRAINT "pocamarket_sync_settings_minute_check" CHECK ("scheduled_minute" BETWEEN 0 AND 59)
);
ALTER TABLE "pocamarket_sync_settings"
ADD CONSTRAINT "pocamarket_sync_settings_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
