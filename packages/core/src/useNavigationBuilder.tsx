import * as React from 'react';
import { NavigationStateContext } from './NavigationContainer';
import NavigationRouteContext from './NavigationRouteContext';
import Screen from './Screen';
import { navigate } from './CommonActions';
import useEventEmitter from './useEventEmitter';
import useRegisterNavigator from './useRegisterNavigator';
import useDescriptors from './useDescriptors';
import useNavigationHelpers from './useNavigationHelpers';
import useOnAction from './useOnAction';
import useFocusEvents from './useFocusEvents';
import useOnRouteFocus from './useOnRouteFocus';
import useChildActionListeners from './useChildActionListeners';
import useFocusedListeners from './useFocusedListeners';
import useFocusedListenersChildrenAdapter from './useFocusedListenersChildrenAdapter';
import {
  DefaultRouterOptions,
  DefaultNavigatorOptions,
  NavigationState,
  ParamListBase,
  RouteConfig,
  Router,
  RouterFactory,
  PartialState,
  PrivateValueStore,
  NavigationAction,
} from './types';
import useStateGetters from './useStateGetters';
import useOnGetState from './useOnGetState';

// This is to make TypeScript compiler happy
// eslint-disable-next-line babel/no-unused-expressions
PrivateValueStore;

type NavigatorRoute = {
  params?: {
    screen?: string;
    params?: object;
  };
};

/**
 * Compare two arrays with primitive values as the content.
 * We need to make sure that both values and order match.
 */
const isArrayEqual = (a: any[], b: any[]) =>
  a.length === b.length && a.every((it, index) => it === b[index]);

/**
 * Extract route config object from React children elements.
 *
 * @param children React Elements to extract the config from.
 */
const getRouteConfigsFromChildren = <ScreenOptions extends object>(
  children: React.ReactNode
) =>
  React.Children.toArray(children).reduce<
    RouteConfig<ParamListBase, string, ScreenOptions>[]
  >((acc, child) => {
    if (React.isValidElement(child)) {
      if (child.type === Screen) {
        // We can only extract the config from `Screen` elements
        // If something else was rendered, it's probably a bug
        acc.push(child.props as RouteConfig<
          ParamListBase,
          string,
          ScreenOptions
        >);
        return acc;
      }

      if (child.type === React.Fragment) {
        // When we encounter a fragment, we need to dive into its children to extract the configs
        // This is handy to conditionally define a group of screens
        acc.push(
          ...getRouteConfigsFromChildren<ScreenOptions>(child.props.children)
        );
        return acc;
      }
    }

    throw new Error(
      `A navigator can only contain 'Screen' components as its direct children (found '${
        // @ts-ignore
        child.type && child.type.name ? child.type.name : String(child)
      }')`
    );
  }, []);

/**
 * Hook for building navigators.
 *
 * @param createRouter Factory method which returns router object.
 * @param options Options object containing `children` and additional options for the router.
 * @returns An object containing `state`, `navigation`, `descriptors` objects.
 */
export default function useNavigationBuilder<
  State extends NavigationState,
  RouterOptions extends DefaultRouterOptions,
  ScreenOptions extends object,
  EventMap extends { [key: string]: any }
>(
  createRouter: RouterFactory<State, any, RouterOptions>,
  options: DefaultNavigatorOptions<ScreenOptions> & RouterOptions
) {
  useRegisterNavigator();

  const route = React.useContext(NavigationRouteContext) as (
    | NavigatorRoute
    | undefined);

  const previousRouteRef = React.useRef(route);

  React.useEffect(() => {
    previousRouteRef.current = route;
  }, [route]);

  const { children, ...rest } = options;
  const { current: router } = React.useRef<Router<State, any>>(
    createRouter({
      ...((rest as unknown) as RouterOptions),
      ...(route && route.params && typeof route.params.screen === 'string'
        ? { initialRouteName: route.params.screen }
        : null),
    })
  );

  const screens = getRouteConfigsFromChildren<ScreenOptions>(children).reduce(
    (acc, curr) => {
      if (curr.name in acc) {
        throw new Error(
          `A navigator cannot contain multiple 'Screen' components with the same name (found duplicate screen named '${curr.name}')`
        );
      }

      acc[curr.name] = curr;
      return acc;
    },
    {} as { [key: string]: RouteConfig<ParamListBase, string, ScreenOptions> }
  );

  const routeNames = Object.keys(screens);
  const routeParamList = routeNames.reduce(
    (acc, curr) => {
      const { initialParams } = screens[curr];
      const initialParamsFromParams =
        route && route.params && route.params.screen === curr
          ? route.params.params
          : undefined;

      acc[curr] =
        initialParams !== undefined || initialParamsFromParams !== undefined
          ? {
              ...initialParams,
              ...initialParamsFromParams,
            }
          : undefined;

      return acc;
    },
    {} as { [key: string]: object | undefined }
  );

  if (!routeNames.length) {
    throw new Error(
      "Couldn't find any screens for the navigator. Have you defined any screens as its children?"
    );
  }

  const {
    state: currentState,
    getState: getCurrentState,
    setState,
    key,
    performTransaction,
  } = React.useContext(NavigationStateContext);

  const previousStateRef = React.useRef<
    NavigationState | PartialState<NavigationState> | undefined
  >();
  const initializedStateRef = React.useRef<State>();

  if (
    initializedStateRef.current === undefined ||
    currentState !== previousStateRef.current
  ) {
    // If the current state isn't initialized on first render, we initialize it
    // We also need to re-initialize it if the state passed from parent was changed (maybe due to reset)
    // Otherwise assume that the state was provided as initial state
    // So we need to rehydrate it to make it usable
    initializedStateRef.current =
      currentState === undefined
        ? router.getInitialState({
            routeNames,
            routeParamList,
          })
        : router.getRehydratedState(currentState as PartialState<State>, {
            routeNames,
            routeParamList,
          });
  }

  React.useEffect(() => {
    previousStateRef.current = currentState;
  }, [currentState]);

  let state =
    // If the state isn't initialized, or stale, use the state we initialized instead
    // The state won't update until there's a change needed in the state we have initalized locally
    // So it'll be `undefined` or stale untill the first navigation event happens
    currentState === undefined || currentState.stale !== false
      ? (initializedStateRef.current as State)
      : (currentState as State);

  let nextState: State = state;

  if (!isArrayEqual(state.routeNames, routeNames)) {
    // When the list of route names change, the router should handle it to remove invalid routes
    nextState = router.getStateForRouteNamesChange(state, {
      routeNames,
      routeParamList,
    });
  }

  if (
    previousRouteRef.current &&
    route &&
    route.params &&
    typeof route.params.screen === 'string' &&
    route.params !== previousRouteRef.current.params
  ) {
    // If the route was updated with new name and/or params, we should navigate there
    // The update should be limited to current navigator only, so we call the router manually
    const updatedState = router.getStateForAction(
      state,
      navigate(route.params.screen, route.params.params)
    );

    nextState =
      updatedState !== null
        ? router.getRehydratedState(updatedState, {
            routeNames,
            routeParamList,
          })
        : state;
  }

  if (state !== nextState) {
    // If the state needs to be updated, we'll schedule an update with React
    // setState in render seems hacky, but that's how React docs implement getDerivedPropsFromState
    // https://reactjs.org/docs/hooks-faq.html#how-do-i-implement-getderivedstatefromprops
    performTransaction(() => {
      setState(nextState);
    });
  }

  // The up-to-date state will come in next render, but we don't need to wait for it
  // We can't use the outdated state since the screens have changed, which will cause error due to mismatched config
  // So we override the state objec we return to use the latest state as soon as possible
  state = nextState;

  React.useEffect(() => {
    return () => {
      // We need to clean up state for this navigator on unmount
      performTransaction(
        () => getCurrentState() !== undefined && setState(undefined)
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getState = React.useCallback((): State => {
    const currentState = getCurrentState();

    return currentState === undefined || currentState.stale !== false
      ? (initializedStateRef.current as State)
      : (currentState as State);
  }, [getCurrentState]);

  const emitter = useEventEmitter();

  useFocusEvents({ state, emitter });

  const {
    listeners: actionListeners,
    addListener: addActionListener,
  } = useChildActionListeners();

  const {
    listeners: focusedListeners,
    addListener: addFocusedListener,
  } = useFocusedListeners();

  const { getStateForRoute, addStateGetter } = useStateGetters();

  const onAction = useOnAction({
    router,
    getState,
    setState,
    key,
    listeners: actionListeners,
  });

  const onRouteFocus = useOnRouteFocus({
    router,
    key,
    getState,
    setState,
  });

  const navigation = useNavigationHelpers<State, NavigationAction, EventMap>({
    onAction,
    getState,
    emitter,
    router,
  });

  useFocusedListenersChildrenAdapter({
    navigation,
    focusedListeners,
  });

  useOnGetState({
    getState,
    getStateForRoute,
  });

  const descriptors = useDescriptors<State, ScreenOptions>({
    state,
    screens,
    navigation,
    screenOptions: options.screenOptions,
    onAction,
    getState,
    setState,
    onRouteFocus,
    addActionListener,
    addFocusedListener,
    addStateGetter,
    router,
    emitter,
  });

  return {
    state,
    navigation,
    descriptors,
  };
}
