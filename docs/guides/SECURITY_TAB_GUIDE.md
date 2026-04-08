# Security Group Management Guide

## How to Access

The Security tab is already built into the Admin Dashboard!

### Navigation Steps:

1. **Go to Admin Dashboard**
   - Look for "Admin" or "Settings" in your navigation menu
   - Or navigate to `/admin` in your application

2. **Click the "Security" Tab**
   - You'll see tabs: "Overview" | "Users" | "Security"
   - Click on **"Security"**

3. **You'll see:**
   - List of all security groups on the left
   - Detailed rules view on the right
   - "Add Rule" button to open ports

## Features Available

### 📋 View Security Groups
- Shows all security groups in your VPC
- Displays inbound/outbound rule counts
- Click any group to see detailed rules

### ➕ Add Rules (Open Ports)
1. Select a security group from the list
2. Click "**+ Add Rule**" button
3. Choose from:
   - **Common applications** (RDP, SSH, HTTP, HTTPS, etc.)
   - **Custom port** (enter any port number)
4. Configure:
   - **Protocol**: TCP, UDP, or All
   - **Source IP/CIDR**: 
     - Use `0.0.0.0/0` for all IPs (not recommended for production)
     - Use specific IP like `1.2.3.4/32` for single IP
     - Use CIDR like `10.0.0.0/8` for range
   - **Description**: Optional note about the rule

### 🗑️ Remove Rules
- Click "Remove" button next to any rule
- Confirms before deletion

## Common Use Cases

### Open RDP Port for Your IP
```
Application: RDP
Port: 3389
Protocol: TCP
Source CIDR: YOUR_IP/32
Description: My home office
```

### Open Custom Port for Multiple Workstations
```
Custom Port: 8080
Protocol: TCP
Source CIDR: 10.0.0.0/24
Description: Internal network access
```

### Open HTTP/HTTPS for Public Access
```
Application: HTTP or HTTPS
Port: 80 or 443
Protocol: TCP
Source CIDR: 0.0.0.0/0
Description: Public web access
```

## Security Best Practices

### ✅ Recommended
- **Use specific IPs** when possible (e.g., `52.1.2.3/32`)
- **Add descriptions** to all rules for documentation
- **Use CIDR blocks** for known networks (e.g., `10.0.0.0/8`)
- **Regularly audit rules** and remove unused ones

### ⚠️ Avoid
- **0.0.0.0/0 for production** (allows access from anywhere)
- **Opening all ports** (use specific ports only)
- **Duplicate rules** (check existing rules first)
- **Leaving unused rules** (remove old rules)

## API Endpoints (Already Deployed)

The backend service is fully functional:

- `GET /admin/security-groups` - List all groups
- `GET /admin/security-groups/{groupId}` - Get group details
- `GET /admin/security-groups/common-ports` - Get common port definitions
- `POST /admin/security-groups/add-rule` - Add inbound rule
- `DELETE /admin/security-groups/remove-rule` - Remove rule

## Common Ports Reference

The system includes these predefined ports:

- **RDP** (3389) - Remote Desktop
- **SSH** (22) - Secure Shell
- **HTTP** (80) - Web traffic
- **HTTPS** (443) - Secure web traffic
- **MySQL** (3306) - Database
- **PostgreSQL** (5432) - Database
- **Redis** (6379) - Cache
- **MongoDB** (27017) - Database
- **Custom** - Any port you specify

## Troubleshooting

### Can't See Security Tab?
1. Make sure you're logged in as admin
2. Navigate to `/admin` or click "Admin" in menu
3. Look for tabs at top: Overview | Users | **Security**

### Can't Add Rules?
1. Make sure you selected a security group first
2. Check you have admin permissions
3. Verify either application name OR custom port is filled

### Rules Not Taking Effect?
1. Allow 1-2 minutes for AWS to propagate changes
2. Verify the security group is attached to your instances
3. Check CloudWatch logs for any errors

## Next Steps

1. Navigate to Admin Dashboard
2. Click Security tab
3. Select your workstation's security group
4. Add rules for the ports you need
5. Specify source IPs for security

The Security Management UI is fully functional and ready to use!