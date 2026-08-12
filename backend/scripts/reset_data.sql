-- Clears all transactional data for a clean start, WITHOUT touching table structure
-- and WITHOUT deleting your employees/login accounts.
--
-- Run with:
--   mysql -u root -p lead2deal < backend/scripts/reset_data.sql
-- or paste directly into your MariaDB CLI / client.

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE activities;
TRUNCATE TABLE tasks;
TRUNCATE TABLE sales_pipeline;
TRUNCATE TABLE properties;
TRUNCATE TABLE sellers;

SET FOREIGN_KEY_CHECKS = 1;

-- employees table is intentionally left untouched so your login accounts survive.