-- Full lead2deal schema, matching your local database exactly (including the email
-- column and Qualify stage you added). Run this once against a fresh Railway MySQL
-- database to recreate everything from scratch.
--
-- Run with a MySQL client connected to your Railway database, or paste directly into
-- Railway's Query tab.

CREATE TABLE employees (
  id INT(11) NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  username VARCHAR(50) NOT NULL,
  password VARCHAR(255) NOT NULL,
  team ENUM('Team Texas','Team Florida','Team Acquisition') NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sellers (
  id INT(11) NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(150) NOT NULL DEFAULT '',
  lead_source ENUM('Facebook','Website','Referral','TV','Walk-in','YouTube') NOT NULL,
  seller_type ENUM('Lead','Seller') NOT NULL DEFAULT 'Lead',
  status ENUM('Active','Inactive','Invalid') NOT NULL DEFAULT 'Active',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE properties (
  id INT(11) NOT NULL AUTO_INCREMENT,
  seller_id INT(11) NOT NULL,
  employee_id INT(11) NOT NULL,
  property_address VARCHAR(255) NOT NULL,
  state ENUM('Texas','Florida') NOT NULL,
  county VARCHAR(100) NOT NULL,
  room INT(11) NOT NULL,
  bathrooms INT(11) NOT NULL,
  market_value DECIMAL(12,2) NOT NULL,
  property_type ENUM('House','Apartment','Office','Shop','Hotel','Warehouse') NOT NULL,
  property_condition ENUM('Excellent','Good','Needs Repairs','Bad') NOT NULL,
  status ENUM('On Process','Complete','Cancelled') NOT NULL DEFAULT 'On Process',
  PRIMARY KEY (id),
  KEY seller_id (seller_id),
  KEY employee_id (employee_id),
  CONSTRAINT fk_properties_seller FOREIGN KEY (seller_id) REFERENCES sellers (id),
  CONSTRAINT fk_properties_employee FOREIGN KEY (employee_id) REFERENCES employees (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sales_pipeline (
  id INT(11) NOT NULL AUTO_INCREMENT,
  seller_id INT(11) NOT NULL,
  property_id INT(11) NULL,
  stage ENUM('New Lead','Qualify','Appointment','Offer','Contract','Closed - Won','Closed - Lost') NOT NULL,
  PRIMARY KEY (id),
  KEY seller_id (seller_id),
  KEY property_id (property_id),
  CONSTRAINT fk_pipeline_seller FOREIGN KEY (seller_id) REFERENCES sellers (id),
  CONSTRAINT fk_pipeline_property FOREIGN KEY (property_id) REFERENCES properties (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tasks (
  id INT(11) NOT NULL AUTO_INCREMENT,
  task VARCHAR(255) NOT NULL,
  seller_id INT(11) NOT NULL,
  property_id INT(11) NULL,
  task_date DATE NOT NULL,
  task_time TIME NOT NULL,
  assigned_to INT(11) NOT NULL,
  status ENUM('Not Done','Done') NOT NULL DEFAULT 'Not Done',
  PRIMARY KEY (id),
  KEY seller_id (seller_id),
  KEY property_id (property_id),
  KEY assigned_to (assigned_to),
  CONSTRAINT fk_tasks_seller FOREIGN KEY (seller_id) REFERENCES sellers (id),
  CONSTRAINT fk_tasks_property FOREIGN KEY (property_id) REFERENCES properties (id),
  CONSTRAINT fk_tasks_employee FOREIGN KEY (assigned_to) REFERENCES employees (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE activities (
  id INT(11) NOT NULL AUTO_INCREMENT,
  performed_by INT(11) NOT NULL,
  activity TEXT NOT NULL,
  activity_date DATE NOT NULL,
  activity_time TIME NOT NULL,
  PRIMARY KEY (id),
  KEY performed_by (performed_by),
  CONSTRAINT fk_activities_employee FOREIGN KEY (performed_by) REFERENCES employees (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;