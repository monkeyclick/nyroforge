import React, { useEffect, useCallback } from 'react';
import { analyticsService } from '../services/analytics';
import { useRouter } from 'next/router';

/**
 * Hook for tracking analytics events
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
    action: 'launch' | 'start' | 'stop' | 'terminate' | 'view',
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

/**
 * HOC to track clicks on any element
 */
export function withClickTracking<P extends { onClick?: () => void }>(
  Component: React.ComponentType<P>,
  category: string,
  action: string,
  label?: string
) {
  return (props: P) => {
    const { onClick, ...rest } = props;
    
    const handleClick = useCallback(() => {
      analyticsService.trackClick(category, action, label);
      onClick?.();
    }, [onClick]);

    return React.createElement(Component, { ...rest, onClick: handleClick } as P);
  };
}