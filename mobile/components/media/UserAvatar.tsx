import { useState } from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';

import { FONT } from '@/lib/holygrail';
import type { Theme } from '@/lib/theme';
import { initialsFor } from '@/lib/media';

// =============================================================================
// Read-only person avatar. The editable one (profile photo, camera sheet) is
// EditableAvatar; this is the plain render used in lists, chat and rows.
//
// Falls back to initials when there's no photo or the fetch fails, so a broken
// URL never leaves a hole in a row.
// =============================================================================

export function UserAvatar({
  uri,
  name,
  size = 36,
  theme,
  /** Ring colour — used in chat to tint each side of the conversation. */
  ring,
}: {
  uri?: string | null;
  name?: string | null;
  size?: number;
  theme: Theme;
  ring?: string;
}) {
  const [failed, setFailed] = useState(false);
  const show = uri && !failed;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.surfaceSunken,
        borderWidth: ring ? 1.5 : 1,
        borderColor: ring ?? theme.hairline,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {show ? (
        <Image
          source={{ uri }}
          onError={() => setFailed(true)}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={140}
          cachePolicy="memory-disk"
        />
      ) : (
        <Text
          style={{
            fontFamily: FONT.sansBold,
            fontSize: Math.round(size * 0.36),
            color: ring ?? theme.muted,
            letterSpacing: -0.2,
          }}
        >
          {initialsFor(name)}
        </Text>
      )}
    </View>
  );
}
