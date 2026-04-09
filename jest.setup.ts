// Set environment variables before Lambda modules are loaded
process.env.WORKSTATIONS_TABLE_NAME = 'test-workstations-table';
process.env.VPC_ID = 'vpc-12345';
process.env.USERS_TABLE = 'test-users-table';
process.env.ROLES_TABLE = 'test-roles-table';
process.env.GROUPS_TABLE = 'test-groups-table';
process.env.AUDIT_TABLE = 'test-audit-table';
process.env.AWS_REGION = 'us-east-1';
process.env.FRONTEND_URL = 'http://localhost:3000';
