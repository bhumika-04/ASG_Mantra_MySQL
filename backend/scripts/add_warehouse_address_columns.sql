-- Adds Address and Pincode to Warehouses (client answer, Oct 2026).
-- Run ONCE on the MySQL database BEFORE deploying the new backend. Existing rows are not changed.
-- Safe to check first:  SHOW COLUMNS FROM Warehouses LIKE 'Address';  SHOW COLUMNS FROM Warehouses LIKE 'Pincode';

USE TechGenia_Analytics;

ALTER TABLE Warehouses
  ADD COLUMN Address VARCHAR(500) NULL AFTER Location,
  ADD COLUMN Pincode VARCHAR(20)  NULL AFTER Address;
