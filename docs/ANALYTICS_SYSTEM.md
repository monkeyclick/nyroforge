# Analytics System Documentation

## Overview

This application now includes a comprehensive analytics system that tracks user interactions, behaviors, and feedback. The system consists of backend services, frontend tracking utilities, and admin dashboards for monitoring user engagement and collecting product feedback.

## Architecture

### Backend Components

#### DynamoDB Tables

1. **UserAnalytics Table**
   - Stores all user events and interactions
   - Partition Key: `eventId`
   - Sort Key: `timestamp`
   - GSIs: UserIndex, EventTypeIndex, CategoryIndex
   - TTL enabled for automatic data cleanup

2. **UserFeedback Table**
   - Stores user feedback submissions
   - Partition Key: `feedbackId`
   - Sort Key: `timestamp`
   - GSIs: UserIndex, StatusIndex, TypeIndex

#### Lambda Service

**Analytics Service** ([`src/lambda/analytics-service/index.ts`](../src/lambda/analytics-service/index.ts))

Endpoints:
- `POST /analytics/track` - Track user events
- `POST /analytics/feedback` - Submit feedback
- `GET /analytics/summary` - Get analytics summary (admin only)
- `GET /analytics/feedback` - List feedback (admin only)
- `GET /analytics/user/{userId}` - Get user-specific analytics

### Frontend Components

#### Services

**Analytics Service** ([`frontend/src/services/analytics.ts`](../frontend/src/services/analytics.ts))

Core functionality:
```typescript
// Track events
analyticsService.trackClick(category, action, label, value, metadata)
analyticsService.trackPageView(pageName, metadata)
analyticsService.trackWorkstationAction(action, workstationId, metadata)
analyticsService.trackInteraction(element, action, metadata)
analyticsService.trackError(errorType, errorMessage, metadata)

// Submit feedback
analyticsService.submitFeedback(feedback)

// Admin queries
analyticsService.getAnalyticsSummary(timeframe)
analyticsService.getFeedbackList(status)
```

#### React Hook

**useAnalytics Hook** ([`frontend/src/hooks/useAnalytics.ts`](../frontend/src/hooks/useAnalytics.ts))

Provides easy access to analytics tracking in React components:
```typescript
const { trackClick, trackWorkstationAction, trackInteraction, trackError } = useAnalytics()
```

Features:
- Automatic page view tracking
- Convenient wrapper functions
- Session management

#### UI Components

1. **FeedbackModal** ([`frontend/src/components/FeedbackModal.tsx`](../frontend/src/components/FeedbackModal.tsx))
   - User-facing feedback form
   - Support for bug reports, feature requests, improvements
   - Optional rating system
   - Accessible from floating button in main layout

2. **AnalyticsDashboard** ([`frontend/src/components/admin/AnalyticsDashboard.tsx`](../frontend/src/components/admin/AnalyticsDashboard.tsx))
   - Admin dashboard for viewing analytics
   - Three tabs: Overview, Recent Events, User Feedback
   - Filterable by timeframe and status
   - Real-time metrics and visualizations

## Usage Examples

### Tracking User Actions

```typescript
import { useAnalytics } from '@/hooks/useAnalytics'

function WorkstationCard({ workstation }) {
  const { trackWorkstationAction, trackClick } = useAnalytics()
  
  const handleLaunch = async () => {
    await trackWorkstationAction('launch', workstation.id, {
      instanceType: workstation.type,
      region: workstation.region
    })
    // Launch workstation...
  }
  
  const handleViewDetails = () => {
    trackClick('workstation', 'view_details', workstation.id)
    // Show details...
  }
  
  return (
    <div>
      <button onClick={handleLaunch}>Launch</button>
      <button onClick={handleViewDetails}>Details</button>
    </div>
  )
}
```

### Collecting User Feedback

The feedback modal is automatically available via the floating button in the main layout. Users can:
- Select feedback type (bug, feature, improvement, other)
- Provide a title and detailed description
- Rate their experience (1-5 stars)
- Submit anonymously or with their user info attached

### Viewing Analytics (Admin)

Admins can access the analytics dashboard from the admin panel:
1. Navigate to Admin Panel
2. Click "Analytics" in the sidebar
3. View metrics, events, and feedback
4. Filter by timeframe or feedback status

## Event Types

### Standard Events

- **click** - User clicks on UI elements
- **pageview** - Page navigation
- **action** - User performs an action (launch, terminate, etc.)
- **interaction** - UI interactions (hover, focus, etc.)
- **error** - Application errors

### Event Categories

- **workstation** - Workstation-related actions
- **navigation** - Page navigation
- **ui** - UI interactions
- **error** - Error tracking
- **general** - General events

### Workstation Actions

- `launch` - Launch a new workstation
- `start` - Start a stopped workstation
- `stop` - Stop a running workstation
- `terminate` - Terminate a workstation
- `view` - View workstation details

## Feedback Types

- **bug** 🐛 - Report bugs or issues
- **feature** 💡 - Request new features
- **improvement** ⚡ - Suggest improvements
- **other** 💬 - General feedback

## Privacy & Data Retention

- Analytics data includes user email and session information
- TTL is configured for automatic data cleanup
- User IPs are collected but can be anonymized
- Feedback is stored indefinitely but can be managed by admins

## Admin Dashboard Features

### Overview Tab
- Total events count
- Unique users count
- Events by category (top 10)
- Top user actions (top 10)
- Configurable timeframes (24h, 7d, 30d, 90d)

### Recent Events Tab
- Last 50 events
- Event details with timestamps
- User identification
- Metadata inspection

### User Feedback Tab
- All feedback submissions
- Filter by status (new, reviewed, in-progress, resolved, closed)
- User ratings
- Feedback metadata (page, timestamp, user)

## Deployment

The analytics system requires:

1. **Infrastructure Changes**
   - Analytics and Feedback DynamoDB tables
   - Analytics Lambda function
   - API Gateway routes

2. **Deploy Command**
   ```bash
   npm run build
   cdk deploy WorkstationInfrastructureStack
   cdk deploy WorkstationApiStack
   ```

3. **Environment Variables**
   Backend automatically configured via CDK with:
   - `ANALYTICS_TABLE_NAME`
   - `FEEDBACK_TABLE_NAME`

## Monitoring

### CloudWatch Metrics

The analytics service logs to CloudWatch:
- Event tracking success/failure
- Feedback submissions
- API errors

### DynamoDB Metrics

Monitor table performance:
- Read/Write capacity
- Item counts
- TTL deletions

## Future Enhancements

Potential improvements:
1. Real-time analytics with WebSockets
2. Custom dashboards for different user roles
3. Analytics exports (CSV, JSON)
4. Advanced filtering and search
5. User behavior funnels
6. A/B testing framework
7. Email notifications for feedback
8. Integration with external analytics platforms

## API Reference

### POST /analytics/track

Track a user event.

**Request:**
```json
{
  "eventType": "click",
  "eventCategory": "workstation",
  "eventAction": "launch",
  "eventLabel": "i-1234567890abcdef0",
  "eventValue": 1,
  "metadata": {
    "instanceType": "g5.xlarge",
    "region": "us-east-1"
  }
}
```

**Response:**
```json
{
  "message": "Event tracked successfully",
  "eventId": "1699876543210-a1b2c3d4e5"
}
```

### POST /analytics/feedback

Submit user feedback.

**Request:**
```json
{
  "feedbackType": "feature",
  "title": "Add workstation templates",
  "description": "It would be great to save workstation configurations as templates",
  "rating": 5
}
```

**Response:**
```json
{
  "message": "Feedback submitted successfully",
  "feedbackId": "fb-1699876543210-a1b2c3d4e5"
}
```

### GET /analytics/summary?timeframe=7d

Get analytics summary (admin only).

**Response:**
```json
{
  "summary": {
    "totalEvents": 1234,
    "uniqueUsers": 45,
    "eventsByCategory": {
      "workstation": 567,
      "navigation": 234,
      "ui": 345
    },
    "eventsByType": {
      "click": 890,
      "pageview": 234,
      "action": 110
    },
    "topActions": {
      "launch": 89,
      "terminate": 45,
      "view_details": 234
    },
    "timeframe": "7d",
    "startDate": "2025-01-05T00:00:00.000Z",
    "endDate": "2025-01-12T00:00:00.000Z"
  },
  "events": [...]
}
```

## Security Considerations

1. **Authentication**: All analytics endpoints require authentication
2. **Authorization**: Admin endpoints check for admin role
3. **Data Privacy**: Personal data is encrypted at rest
4. **Rate Limiting**: API Gateway throttling prevents abuse
5. **Input Validation**: All inputs are validated and sanitized

## Troubleshooting

### Events Not Being Tracked

1. Check browser console for errors
2. Verify API endpoint configuration
3. Check user authentication status
4. Review Lambda logs in CloudWatch

### Admin Dashboard Not Loading

1. Verify admin role assignment
2. Check DynamoDB table permissions
3. Review API Gateway logs
4. Verify analytics tables exist

### Feedback Submission Failing

1. Check required fields are filled
2. Verify network connectivity
3. Review Lambda execution logs
4. Check DynamoDB write capacity

## Support

For issues or questions about the analytics system:
1. Check this documentation
2. Review CloudWatch logs
3. Check the admin analytics dashboard for system health
4. Use the feedback modal to report issues