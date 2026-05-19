import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { captureError } from '@/lib/sentry';

interface State {
  error: Error | null;
}

interface Props {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    captureError(error, { componentStack: info.componentStack });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <View className="flex-1 items-center justify-center bg-bg px-6">
          <Text className="font-bold text-2xl text-text-primary mb-2">
            Something went wrong
          </Text>
          <Text className="font-sans text-text-secondary text-center mb-6">
            We hit an unexpected error. Please try again.
          </Text>
          <Pressable
            onPress={this.reset}
            className="bg-brand rounded-xl px-6 py-3"
          >
            <Text className="font-bold text-bg">Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}
