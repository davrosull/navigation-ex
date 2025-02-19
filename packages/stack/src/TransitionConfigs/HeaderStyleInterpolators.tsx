import { I18nManager } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  StackHeaderInterpolationProps,
  StackHeaderInterpolatedStyle,
} from '../types';

const { interpolate, add } = Animated;

/**
 * Standard UIKit style animation for the header where the title fades into the back button label.
 */
export function forUIKit({
  current,
  next,
  layouts,
}: StackHeaderInterpolationProps): StackHeaderInterpolatedStyle {
  const defaultOffset = 100;
  const leftSpacing = 27;

  // The title and back button title should cross-fade to each other
  // When screen is fully open, the title should be in center, and back title should be on left
  // When screen is closing, the previous title will animate to back title's position
  // And back title will animate to title's position
  // We achieve this by calculating the offsets needed to translate title to back title's position and vice-versa
  const leftLabelOffset = layouts.leftLabel
    ? (layouts.screen.width - layouts.leftLabel.width) / 2 - leftSpacing
    : defaultOffset;
  const titleLeftOffset = layouts.title
    ? (layouts.screen.width - layouts.title.width) / 2 - leftSpacing
    : defaultOffset;

  // When the current title is animating to right, it is centered in the right half of screen in middle of transition
  // The back title also animates in from this position
  const rightOffset = layouts.screen.width / 4;

  const progress = add(current.progress, next ? next.progress : 0);

  return {
    leftButtonStyle: {
      opacity: interpolate(progress, {
        inputRange: [0.3, 1, 1.5],
        outputRange: [0, 1, 0],
      }),
    },
    leftLabelStyle: {
      transform: [
        {
          translateX: interpolate(progress, {
            inputRange: [0, 1, 2],
            outputRange: I18nManager.isRTL
              ? [-rightOffset, 0, leftLabelOffset]
              : [leftLabelOffset, 0, -rightOffset],
          }),
        },
      ],
    },
    rightButtonStyle: {
      opacity: interpolate(progress, {
        inputRange: [0.3, 1, 1.5],
        outputRange: [0, 1, 0],
      }),
    },
    titleStyle: {
      opacity: interpolate(progress, {
        inputRange: [0, 0.4, 1, 1.5],
        outputRange: [0, 0.1, 1, 0],
      }),
      transform: [
        {
          translateX: interpolate(progress, {
            inputRange: [0.5, 1, 2],
            outputRange: I18nManager.isRTL
              ? [-titleLeftOffset, 0, rightOffset]
              : [rightOffset, 0, -titleLeftOffset],
          }),
        },
      ],
    },
    backgroundStyle: {
      transform: [
        {
          translateX: interpolate(progress, {
            inputRange: [0, 1, 2],
            outputRange: I18nManager.isRTL
              ? [-layouts.screen.width, 0, layouts.screen.width]
              : [layouts.screen.width, 0, -layouts.screen.width],
          }),
        },
      ],
    },
  };
}

/**
 * Simple fade animation for the header elements.
 */
export function forFade({
  current,
  next,
}: StackHeaderInterpolationProps): StackHeaderInterpolatedStyle {
  const progress = add(current.progress, next ? next.progress : 0);
  const opacity = interpolate(progress, {
    inputRange: [0, 1, 2],
    outputRange: [0, 1, 0],
  });

  return {
    leftButtonStyle: { opacity },
    rightButtonStyle: { opacity },
    titleStyle: { opacity },
    backgroundStyle: { opacity: current.progress },
  };
}

/**
 * Simple translate animation to translate the header along with the sliding screen.
 */
export function forStatic({
  current,
  next,
  layouts: { screen },
}: StackHeaderInterpolationProps): StackHeaderInterpolatedStyle {
  const progress = add(current.progress, next ? next.progress : 0);
  const translateX = interpolate(progress, {
    inputRange: [0, 1, 2],
    outputRange: I18nManager.isRTL
      ? [-screen.width, 0, screen.width]
      : [screen.width, 0, -screen.width],
  });

  const transform = [{ translateX }];

  return {
    leftButtonStyle: { transform },
    rightButtonStyle: { transform },
    titleStyle: { transform },
    backgroundStyle: { transform },
  };
}

export function forNoAnimation(): StackHeaderInterpolatedStyle {
  return {};
}
