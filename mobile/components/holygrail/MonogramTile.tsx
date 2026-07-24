import { View, Text } from 'react-native';
import { FONT } from '@/lib/holygrail';
import { useTheme } from '@/lib/theme';

// Holy Grail player identity tile. Square, rounded corners, brand-tinted bg,
// initials in DM Sans semibold, jersey number badge in Plex Mono on the corner.
// NEVER use photography per the spec.

interface Props {
  initials: string;
  jersey?: string | null;
  size?: number; // default 52
  showJersey?: boolean;
}

export function MonogramTile({ initials, jersey, size = 52, showJersey = true }: Props) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(8, size * 0.22),
        backgroundColor: theme.surfaceSunken,
        borderWidth: 1,
        borderColor: theme.hairline,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <Text
        style={{
          fontFamily: FONT.sansBold,
          fontSize: Math.round(size * 0.32),
          color: theme.ink,
          letterSpacing: -0.3,
        }}
      >
        {initials}
      </Text>

      {showJersey && jersey ? (
        <View
          style={{
            position: 'absolute',
            right: -4,
            bottom: -4,
            backgroundColor: theme.bg,
            borderColor: theme.hairline,
            borderWidth: 1,
            borderRadius: 6,
            paddingHorizontal: 5,
            paddingVertical: 1,
            minWidth: 18,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: FONT.monoBold,
              fontSize: Math.max(8, Math.round(size * 0.18)),
              color: theme.accent,
              letterSpacing: 0.3,
            }}
          >
            {jersey}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
