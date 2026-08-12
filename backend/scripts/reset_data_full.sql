-- Full reset: wipes EVERY table, including employees.
-- WARNING: this deletes all login accounts too. You will need to reseed
-- employees (npm run seed, or manual INSERTs) before anyone can log in again.
--
-- Run with:
--   mysql -u root -p lead2deal < backend/scripts/reset_data_full.sql

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE activities;
TRUNCATE TABLE tasks;
TRUNCATE TABLE sales_pipeline;
TRUNCATE TABLE properties;
TRUNCATE TABLE sellers;
TRUNCATE TABLE employees;

SET FOREIGN_KEY_CHECKS = 1;
