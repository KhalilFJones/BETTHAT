import { useRef, useState } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator, Platform } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';

import { FONT } from '@/lib/holygrail';
import type { Theme } from '@/lib/theme';
import { useAvatarUpload, type AvatarSource } from '@/hooks/useAvatarUpload';

// =============================================================================
// Profile photo with the Instagram affordance: tap the picture (or the small
// camera badge on its edge) to open a sheet offering Take Photo / Choose from
// Library, plus Remove once one is set.
//
// Owns nothing but the sheet — capture, upload and the profiles write all live
// in useAvatarUpload so other entry points can reuse them.
// =============================================================================

export function EditableAvatar({
  uri,
  initials,
  size = 88,
  theme,
  onRemove,
}: {
  uri?: string | null;
  initials: string;
  size?: number;
  theme: Theme;
  /** Omit to hide the Remove action. */
  onRemove?: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { pick, uploading } = useAvatarUpload();

  // iOS cannot present the system camera/library picker while this Modal is
  // still animating out — the presentation is silently dropped and the tap
  // appears to do nothing. So the choice is parked here, the sheet closes,
  // and the picker launches from onDismiss once the modal is really gone.
  // Android has no such restriction (the picker is its own Activity).
  const pendingRef = useRef<AvatarSource | null>(null);

  const launchPending = () => {
    const source = pendingRef.current;
    pendingRef.current = null;
    if (source) void pick(source);
  };

  const choose = (source: AvatarSource) => {
    pendingRef.current = source;
    setSheetOpen(false);
    if (Platform.OS !== 'ios') launchPending();
  };

  const badge = Math.max(24, Math.round(size * 0.3));

  return (
    <>
      <Pressable
        onPress={() => setSheetOpen(true)}
        disabled={uploading}
        accessibilityRole="button"
        accessibilityLabel="Change profile photo"
        style={{ width: size, height: size }}
      >
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: theme.surfaceSunken,
            borderWidth: 1,
            borderColor: theme.hairline,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {uri ? (
            <Image
              source={{ uri }}
              style={{ width: size, height: size }}
              contentFit="cover"
              transition={160}
              cachePolicy="memory-disk"
            />
          ) : (
            <Text
              style={{
                fontFamily: FONT.sansBold,
                fontSize: Math.round(size * 0.34),
                color: theme.muted,
                letterSpacing: -0.4,
              }}
            >
              {initials}
            </Text>
          )}

          {uploading ? (
            <View
              style={{
                position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <ActivityIndicator color="#FFFFFF" />
            </View>
          ) : null}
        </View>

        <View
          style={{
            position: 'absolute', right: -2, bottom: -2,
            width: badge, height: badge, borderRadius: badge / 2,
            backgroundColor: theme.accent,
            borderWidth: 2, borderColor: theme.surface,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Svg
            width={badge * 0.55} height={badge * 0.55} viewBox="0 0 24 24"
            fill="none" stroke={theme.onAccent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          >
            <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <Path d="M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
          </Svg>
        </View>
      </Pressable>

      <Modal
        visible={sheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetOpen(false)}
        onDismiss={Platform.OS === 'ios' ? launchPending : undefined}
      >
        <Pressable
          onPress={() => setSheetOpen(false)}
          accessibilityLabel="Dismiss"
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
        >
          {/* Stop the backdrop press from firing when the sheet itself is hit. */}
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: theme.surface,
              borderTopLeftRadius: 20, borderTopRightRadius: 20,
              paddingTop: 8, paddingBottom: 34, paddingHorizontal: 16, gap: 2,
            }}
          >
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.hairline2, marginBottom: 10 }} />
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 17, color: theme.ink, paddingHorizontal: 4, paddingBottom: 6 }}>
              Profile photo
            </Text>

            <SheetAction theme={theme} label="Take Photo" onPress={() => choose('camera')} />
            <SheetAction theme={theme} label="Choose from Library" onPress={() => choose('library')} />
            {uri && onRemove ? (
              <SheetAction
                theme={theme}
                label="Remove Current Photo"
                tone={theme.danger}
                onPress={() => { setSheetOpen(false); onRemove(); }}
              />
            ) : null}
            <SheetAction theme={theme} label="Cancel" muted onPress={() => setSheetOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function SheetAction({
  theme, label, onPress, tone, muted,
}: {
  theme: Theme; label: string; onPress: () => void; tone?: string; muted?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ height: 52, justifyContent: 'center', paddingHorizontal: 4 }}
    >
      <Text
        style={{
          fontFamily: muted ? FONT.sans : FONT.sansMedium,
          fontSize: 16,
          color: tone ?? (muted ? theme.muted : theme.ink),
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
