import { useCallback, useState } from 'react';
import { Alert, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth.store';

// =============================================================================
// Profile photo capture — camera or library, Instagram-style.
//
// The picker's own square-crop editor does the framing, so nothing here has to
// resize; `quality` keeps the result well under the bucket's 5 MB ceiling.
//
// Files land at avatars/<uid>/<timestamp>.jpg. The timestamp matters: the
// bucket is public and served through a CDN, so overwriting one fixed path
// would leave the old photo cached at the same URL. A fresh key per upload
// sidesteps that, and the previous object is removed afterwards.
// =============================================================================

export type AvatarSource = 'camera' | 'library';

export function useAvatarUpload() {
  const [uploading, setUploading] = useState(false);
  const { profile, setProfile } = useAuthStore();
  const qc = useQueryClient();

  const pick = useCallback(
    async (source: AvatarSource) => {
      if (!profile?.id) return;

      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        const what = source === 'camera' ? 'camera' : 'photo library';
        Alert.alert(
          `${what[0].toUpperCase()}${what.slice(1)} access needed`,
          `BETTHAT needs ${what} access to set your profile photo. You can turn it on in Settings.`,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      };

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);

      if (result.canceled || !result.assets?.[0]?.uri) return;
      await upload(result.assets[0].uri, profile.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile?.id],
  );

  async function upload(localUri: string, userId: string) {
    setUploading(true);
    try {
      // React Native's fetch can read a file:// URI into a blob; arrayBuffer()
      // then gives supabase-js the bytes directly. Passing the blob itself
      // uploads a zero-byte object on Android.
      const bytes = await (await fetch(localUri)).arrayBuffer();
      if (bytes.byteLength === 0) throw new Error('Could not read the selected image.');

      const path = `${userId}/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
      if (uploadError) throw uploadError;

      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);
      if (profileError) throw profileError;

      // Drop the previous photo so a user's folder doesn't grow without bound.
      const previous = extractStoragePath(profile?.avatar_url ?? null, userId);
      if (previous) await supabase.storage.from('avatars').remove([previous]);

      setProfile({ ...(profile as any), avatar_url: publicUrl });
      // Every surface that renders someone's avatar reads it from a query.
      qc.invalidateQueries();
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Could not update your profile photo.');
    } finally {
      setUploading(false);
    }
  }

  return { pick, uploading };
}

/** ".../avatars/<uid>/<file>.jpg" -> "<uid>/<file>.jpg", or null if not ours. */
function extractStoragePath(url: string | null, userId: string): string | null {
  if (!url) return null;
  const marker = '/avatars/';
  const at = url.indexOf(marker);
  if (at === -1) return null;
  const path = url.slice(at + marker.length).split('?')[0];
  return path.startsWith(`${userId}/`) ? path : null;
}
