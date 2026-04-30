# Contábil Manager Pro (React Version)

This is a modern React/TypeScript implementation of the Accounting Management System.

## Features
- **Dashboard:** Real-time overview of tasks and companies.
- **Kanban Board:** Drag-and-drop task management.
- **Companies:** Manage Normal and MEI companies.
- **Documents:** Track document status per competence.
- **WhatsApp:** Mock connection interface.

## Deployment to Easypanel
1. **Docker:** This project includes a `Dockerfile` optimized for Nginx serving a React Static Build.
2. **Database:** Since this is a Client-Side App, it currently uses Mock Data (`constants.ts`). To persist data in `/app/data` as requested, you would need to connect this frontend to your Python API.

## Running Locally
1. `npm install`
2. `npm start`
