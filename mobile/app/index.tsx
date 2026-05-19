import { Redirect } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { View } from 'react-native';

export default function Index() {
  const { session, profile, isInitialized } = useAuth();

  if (!isInitialized) return <View className="flex-1 bg-[#0A0A0C]" />;

  if (!session) return <Redirect href="/(auth)/login" />;
  if (!profile?.username) return <Redirect href="/(auth)/onboarding" />;
  return <Redirect href="/(tabs)/home" />;
}
