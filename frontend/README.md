# Media Workstation Management - Next.js Frontend

Modern React-based frontend for managing AWS EC2 media workstations, built with Next.js 14, TypeScript, and Tailwind CSS.

---

## 🎯 Features

### User Features
- **Dashboard**: View and manage your workstations
- **Launch Workstations**: Create new EC2 instances with customizable configurations
- **Status Monitoring**: Real-time workstation status updates
- **Cost Analytics**: Track spending with visual charts
- **Credentials Management**: Securely access workstation credentials
- **Workstation Actions**: Terminate, view details, download RDP files

### Admin Features
- **User Management**: Create, edit, suspend/activate users
- **Role Management**: Define roles with granular permissions
- **Group Management**: Organize users into groups
- **Security Management**: Manage security groups and network rules
- **Audit Logs**: View system activity and changes

---

## 🛠️ Tech Stack

- **Framework**: Next.js 14 (Pages Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand + TanStack Query
- **Authentication**: AWS Amplify + Cognito
- **Charts**: Recharts
- **Forms**: React Hook Form
- **Notifications**: React Hot Toast
- **HTTP Client**: Fetch API with custom wrapper

---

## 📁 Project Structure

```
frontend/
├── pages/                    # Next.js pages
│   ├── _app.tsx             # App wrapper with providers
│   ├── _document.tsx        # HTML document
│   ├── index.tsx            # Dashboard page
│   ├── login.tsx            # Login page
│   ├── signup.tsx           # Signup page
│   └── admin/
│       └── index.tsx        # Admin dashboard
├── src/
│   ├── components/          # React components
│   │   ├── admin/          # Admin-specific components
│   │   ├── dashboard/      # Dashboard widgets
│   │   └── workstation/    # Workstation components
│   ├── layouts/            # Page layouts
│   │   ├── MainLayout.tsx  # Authenticated layout
│   │   └── AuthLayout.tsx  # Login/signup layout
│   ├── services/           # API services
│   │   └── api.ts         # API client
│   ├── stores/             # State management
│   │   └── authStore.ts   # Auth state
│   ├── types/              # TypeScript types
│   └── styles/             # Global styles
├── public/                  # Static assets
├── .env.local.example      # Environment template
├── next.config.js          # Next.js configuration
├── tailwind.config.js      # Tailwind configuration
└── tsconfig.json           # TypeScript configuration
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- AWS credentials configured

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.local.example .env.local

# Edit with your values
nano .env.local
```

### Environment Variables

Create `.env.local` with:

```env
NEXT_PUBLIC_AWS_REGION=us-west-2
NEXT_PUBLIC_USER_POOL_ID=us-west-2_XXXXXXXXX
NEXT_PUBLIC_USER_POOL_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_API_ENDPOINT=https://xxxxxxxxxx.execute-api.us-west-2.amazonaws.com/prod
```

### Development

```bash
# Run development server
npm run dev

# Open http://localhost:3000
```

### Build

```bash
# Build for production
npm run build

# Output will be in out/

# Test production build locally
npx serve out
```

---

## 📦 Deployment

The frontend is automatically deployed via AWS CDK:

```bash
# From project root
cd ../
npm run cdk deploy WorkstationWebsite
```

This will:
1. Build the Next.js application
2. Deploy to S3
3. Create/update CloudFront distribution
4. Output the website URL

See [NEXTJS_DEPLOYMENT_GUIDE.md](../NEXTJS_DEPLOYMENT_GUIDE.md) for detailed deployment instructions.

---

## 🧪 Testing

```bash
# Run tests (when implemented)
npm run test

# Run linter
npm run lint

# Type check
npx tsc --noEmit
```

---

## 📚 Key Components

### Authentication
- **Login Page** (`pages/login.tsx`): User authentication
- **Signup Page** (`pages/signup.tsx`): New user registration
- **Auth Store** (`stores/authStore.ts`): Global auth state with persistence

### Dashboard
- **Main Dashboard** (`pages/index.tsx`): Workstation list and overview
- **Status Metrics** (`components/dashboard/StatusMetrics.tsx`): Instance statistics
- **Cost Analytics** (`components/dashboard/CostAnalyticsChart.tsx`): Cost visualization

### Admin
- **Admin Dashboard** (`components/admin/AdminDashboard.tsx`): Tabbed admin interface
- **Security Management** (`components/admin/SecurityManagement.tsx`): Network security configuration
- **User Management**: CRUD operations for users
- **Role/Group Management**: RBAC configuration

### Workstations
- **Workstation Card** (`components/workstation/WorkstationCard.tsx`): Individual workstation display
- **Launch Modal** (`components/workstation/LaunchWorkstationModal.tsx`): Create new workstations

---

## 🔌 API Integration

The frontend communicates with the backend via a REST API:

```typescript
// Example API usage
import { apiClient } from '@/services/api'

// Get workstations
const { workstations } = await apiClient.getWorkstations()

// Launch workstation
const workstation = await apiClient.launchWorkstation({
  region: 'us-west-2',
  instanceType: 'g4dn.xlarge',
  // ...
})

// Terminate workstation
await apiClient.terminateWorkstation(instanceId)
```

All API calls include:
- Automatic authentication headers
- Error handling
- Type safety
- Request/response transformation

---

## 🎨 Styling

### Tailwind CSS

Components use Tailwind utility classes:

```tsx
<div className="bg-white rounded-lg shadow-sm p-6">
  <h2 className="text-xl font-semibold text-gray-900">
    Title
  </h2>
</div>
```

### Custom Styles

Global styles in `src/styles/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --primary: 221.2 83.2% 53.3%;
    /* ... */
  }
}
```

---

## 🔐 Authentication Flow

1. User visits app
2. `_app.tsx` checks auth state
3. If not authenticated, redirect to `/login`
4. User logs in via AWS Cognito
5. Auth token stored in localStorage
6. Token used for API requests
7. On logout, token cleared and redirect to login

---

## 📊 State Management

### Zustand for Auth
```typescript
const { user, isAuthenticated, login, logout } = useAuthStore()
```

### TanStack Query for API
```typescript
const { data, isLoading } = useQuery({
  queryKey: ['workstations'],
  queryFn: () => apiClient.getWorkstations()
})
```

---

## 🐛 Common Issues

### Build Errors

**Problem**: TypeScript errors
```bash
# Check errors
npm run lint
npx tsc --noEmit
```

**Problem**: Out of memory
```bash
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

### Runtime Errors

**Problem**: CORS errors
- Check API endpoint in `.env.local`
- Verify API Gateway CORS configuration

**Problem**: Authentication not working
- Verify Cognito configuration
- Check User Pool ID and Client ID

---

## 🔄 Development Workflow

1. **Create feature branch**
   ```bash
   git checkout -b feature/new-feature
   ```

2. **Make changes**
   ```bash
   # Edit files
   npm run dev  # Test locally
   ```

3. **Build and test**
   ```bash
   npm run build
   npx serve out
   ```

4. **Commit and push**
   ```bash
   git add .
   git commit -m "Add new feature"
   git push origin feature/new-feature
   ```

5. **Deploy**
   ```bash
   cd ../
   npm run cdk deploy WorkstationWebsite
   ```

---

## 📖 Additional Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [TanStack Query Documentation](https://tanstack.com/query/latest)
- [AWS Amplify Documentation](https://docs.amplify.aws/)

---

## 🤝 Contributing

1. Follow TypeScript best practices
2. Use Tailwind for styling
3. Add types for all props and functions
4. Test changes locally before committing
5. Keep components small and focused
6. Document complex logic

---

## 📝 Notes

- This is a static export (no SSR)
- Authentication requires AWS Amplify setup
- All routes are protected except login/signup
- Admin features require admin role
- Security tab provides full network management

---

## 🔗 Related Documentation

- [Migration Plan](../NEXTJS_MIGRATION_PLAN.md)
- [Migration Status](../NEXTJS_MIGRATION_STATUS.md)
- [Deployment Guide](../NEXTJS_DEPLOYMENT_GUIDE.md)