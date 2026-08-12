# Lead2Deal — Real Estate CRM

React + Node/Express + MariaDB app for managing seller leads through to closed deals,
matching the `lead2deal` database schema (employees, sellers, properties, sales_pipeline, tasks, activities).

## 1. Database

Your existing MariaDB `lead2deal` database and schema are used as-is — nothing to migrate.
You just need at least one row in `employees` per team so auto-assignment has someone to pick:
at least 1 employee with `team = 'Team Acquisition'`, 1 with `'Team Texas'`, 1 with `'Team Florida'`.

Passwords must be **bcrypt hashes**, not plain text. To add an employee:

```bash
cd backend
node utils/hashPassword.js "theirPlainTextPassword"
# copy the printed hash into a manual INSERT:
# INSERT INTO employees (name, username, password, team) VALUES ('Angelo', 'angelo', '<hash>', 'Team Texas');
```

## 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env
# edit .env with your MariaDB credentials and a random JWT_SECRET
npm run dev        # starts on http://localhost:5000
```

## 3. Frontend setup

```bash
cd frontend
npm install
npm run dev         # starts on http://localhost:5173, proxies /api -> :5000
```

Log in at `http://localhost:5173/login` with an employee's `username`/password.

## How the automation works

**Task chain** (`backend/utils/taskFlow.js`) — completing one task in the chain auto-creates
the next task and (where applicable) advances `sales_pipeline.stage`:

1. Seller registered → task **"Get Property Info"** (Team Acquisition, random agent)
2. Property recorded → stage **New Lead** + task **"Review Property Info"** (state's team, random agent — this agent stays assigned for the rest of the deal)
3. Review done → stage **Appointment** + task **"Set Schedule for On-site Inspection"**
4. Schedule done → task **"On-site Inspection"**
5. Inspection done → task **"Update or Confirm Property Details"**
6. Details confirmed → stage **Offer** + task **"Send Offer to Seller"**
7. Offer sent → task **"Negotiate the Offer"**
8. Negotiation done → stage **Contract** + task **"Contract Signing"**
9. Contract signed → stage **Closed - Won**

Manual tasks can still be added/edited any time from the Task module — they just won't
trigger the chain unless their name matches one of the steps above.

**Team/Agent routing** (`backend/utils/assignAgent.js`): Texas → Team Texas, Florida → Team Florida,
random pick within the team (no other rule specified). Changing a property's state re-routes it.

**Dashboard counts** are pulled live from `sales_pipeline.stage` (New Lead / Offer / Contract / Closed - Won).

**Every write action logs to `activities`** automatically (seen in the Logs module) — you don't
need to log anything manually from the frontend.

## Project structure

```
backend/
  config/db.js          MariaDB pool
  middleware/auth.js     JWT cookie auth guard
  utils/                 assignAgent, taskFlow (automation config), logActivity, hashPassword CLI
  controllers/           one per module (auth, seller, property, task, pipeline, dashboard, activity, employee)
  routes/                Express routers, all mounted under /api/*
  server.js

frontend/
  src/api/axios.js       shared axios instance (withCredentials for the JWT cookie)
  src/context/AuthContext.jsx
  src/components/        Sidebar, PrivateRoute, Modal
  src/pages/              Login, Dashboard, Leads, Properties, Tasks, Pipeline, Logs
  src/styles/index.css
```
