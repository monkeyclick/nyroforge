import { apiClient } from './api';

export interface AnalyticsEvent {
  eventType?: string;
  eventCategory: string;
  eventAction: string;
  eventLabel?: string;
  eventValue?: number;
  metadata?: Record<string, any>;
  sessionId?: string;
}

export interface FeedbackSubmission {
  feedbackType: 'bug' | 'feature' | 'improvement' | 'other';
  title: string;
  description: string;
  rating?: number;
  page?: string;
  metadata?: Record<string, any>;
}

class AnalyticsService {
  private sessionId: string;
  private isEnabled: boolean = true;

  constructor() {
    // Generate or retrieve session ID (only in browser)
    this.sessionId = this.getOrCreateSessionId();
  }

  private getOrCreateSessionId(): string {
    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
    const existingSession = sessionStorage.getItem('analytics_session_id');
    if (existingSession) {
      return existingSession;
    }
    
    const newSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('analytics_session_id', newSessionId);
    return newSessionId;
  }

  /**
   * Enable or disable analytics tracking
   */
  setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
  }

  /**
   * Track a user event
   */
  async trackEvent(event: AnalyticsEvent): Promise<void> {
    // Skip tracking during SSR
    if (typeof window === 'undefined' || !this.isEnabled) return;

    try {
      await apiClient.post('/analytics/track', {
        ...event,
        sessionId: this.sessionId,
        eventType: event.eventType || 'click',
      });
    } catch (error) {
      console.error('Failed to track event:', error);
      // Silently fail - don't disrupt user experience
    }
  }

  /**
   * Track a click event
   */
  async trackClick(
    category: string,
    action: string,
    label?: string,
    value?: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    return this.trackEvent({
      eventType: 'click',
      eventCategory: category,
      eventAction: action,
      eventLabel: label,
      eventValue: value,
      metadata,
    });
  }

  /**
   * Track a page view
   */
  async trackPageView(pageName: string, metadata?: Record<string, any>): Promise<void> {
    return this.trackEvent({
      eventType: 'pageview',
      eventCategory: 'navigation',
      eventAction: 'page_view',
      eventLabel: pageName,
      metadata,
    });
  }

  /**
   * Track workstation actions
   */
  async trackWorkstationAction(
    action: 'launch' | 'start' | 'stop' | 'terminate' | 'view',
    workstationId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    return this.trackEvent({
      eventType: 'action',
      eventCategory: 'workstation',
      eventAction: action,
      eventLabel: workstationId,
      metadata,
    });
  }

  /**
   * Track user interaction
   */
  async trackInteraction(
    element: string,
    action: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    return this.trackEvent({
      eventType: 'interaction',
      eventCategory: 'ui',
      eventAction: action,
      eventLabel: element,
      metadata,
    });
  }

  /**
   * Track errors
   */
  async trackError(
    errorType: string,
    errorMessage: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    return this.trackEvent({
      eventType: 'error',
      eventCategory: 'error',
      eventAction: errorType,
      eventLabel: errorMessage,
      metadata,
    });
  }

  /**
   * Submit user feedback
   */
  async submitFeedback(feedback: FeedbackSubmission): Promise<{ feedbackId: string }> {
    try {
      const data = await apiClient.post<{ feedbackId: string }>('/analytics/feedback', {
        ...feedback,
        page: typeof window !== 'undefined' ? window.location.pathname : undefined,
      });
      return data;
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      throw error;
    }
  }

  /**
   * Get analytics summary (admin only)
   */
  async getAnalyticsSummary(timeframe: '24h' | '7d' | '30d' | '90d' = '7d'): Promise<any> {
    try {
      const endpoint = `/analytics/summary?timeframe=${encodeURIComponent(timeframe)}`;
      const data = await apiClient.get<any>(endpoint);
      return data;
    } catch (error) {
      console.error('Failed to get analytics summary:', error);
      throw error;
    }
  }

  /**
   * Get feedback list (admin only)
   */
  async getFeedbackList(status?: string): Promise<any> {
    try {
      const endpoint = status
        ? `/analytics/feedback?status=${encodeURIComponent(status)}`
        : '/analytics/feedback';
      const data = await apiClient.get<any>(endpoint);
      return data;
    } catch (error) {
      console.error('Failed to get feedback list:', error);
      throw error;
    }
  }

  /**
   * Get user analytics
   */
  async getUserAnalytics(userId: string): Promise<any> {
    try {
      const data = await apiClient.get<any>(`/analytics/user/${userId}`);
      return data;
    } catch (error) {
      console.error('Failed to get user analytics:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();

export default analyticsService;