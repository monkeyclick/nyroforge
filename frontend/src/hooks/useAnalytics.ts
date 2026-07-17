import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { analyticsService } from '../services/analytics';

/**
 * Hook for tracking analytics events. Tracks page views automatically
 * (initial load + route changes) and exposes typed helpers for manual events.
 * Whether events actually send is governed by analyticsService.setEnabled().
 */
export function useAnalytics() {
  const router = useRouter();

  // Track page views automatically
  useEffect(() => {
    const handleRouteChange = (url: string) => {
      analyticsService.trackPageView(url);
    };

    router.events.on('routeChangeComplete', handleRouteChange);

    // Track initial page view
    analyticsService.trackPageView(router.pathname);

    return () => {
      router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, [router]);

  const trackClick = useCallback((
    category: string,
    action: string,
    label?: string,
    value?: number,
    metadata?: Record<string, any>
  ) => {
    return analyticsService.trackClick(category, action, label, value, metadata);
  }, []);

  const trackWorkstationAction = useCallback((
    action: 'launch' | 'start' | 'stop' | 'reboot' | 'terminate' | 'view',
    workstationId?: string,
    metadata?: Record<string, any>
  ) => {
    return analyticsService.trackWorkstationAction(action, workstationId, metadata);
  }, []);

  const trackInteraction = useCallback((
    element: string,
    action: string,
    metadata?: Record<string, any>
  ) => {
    return analyticsService.trackInteraction(element, action, metadata);
  }, []);

  const trackError = useCallback((
    errorType: string,
    errorMessage: string,
    metadata?: Record<string, any>
  ) => {
    return analyticsService.trackError(errorType, errorMessage, metadata);
  }, []);

  return {
    trackClick,
    trackWorkstationAction,
    trackInteraction,
    trackError,
  };
}
