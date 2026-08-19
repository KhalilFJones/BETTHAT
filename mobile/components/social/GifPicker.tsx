import { useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, Modal, Image, FlatList, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { FONT } from '@/lib/holygrail';
import type { Theme } from '@/lib/theme';

// =============================================================================
// GIF picker for comment replies.
//
// Deliberately has NO hard dependency on a third-party GIF API. Tenor closed
// its API to third parties on 2026-06-30, and GIPHY now describes API access
// as limited to "select partners", so building the feature on either would
// mean it stops working the moment that access lapses.
//
// Instead there are two sources that always work:
//   • Library — every GIF already used in a comment anywhere in the app. This
//     bootstraps itself: each pasted GIF becomes available to everyone next.
//   • Link    — paste any GIF URL (Giphy/Tenor share links, Imgur, your own
//     Supabase Storage bucket, anything that resolves to an image).
//
// A provider search tab appears automatically IF a key is configured, so
// wiring one in later is a config change, not a rewrite. Comments store a
// plain `gif_url`, so nothing downstream cares where the GIF came from.
// =============================================================================

const GIPHY_KEY = process.env.EXPO_PUBLIC_GIPHY_API_KEY;

export interface GifResult {
  id: string;
  url: string;
  preview: string;
  description: string;
}

type Tab = 'library' | 'link' | 'search';

export function GifPicker({
  theme, visible, onClose, onSelect,
}: {
  theme: Theme; visible: boolean; onClose: () => void; onSelect: (gif: GifResult) => void;
}) {
  const [tab, setTab] = useState<Tab>('library');
  const [link, setLink] = useState('');
  const [query, setQuery] = useState('');

  const tabs = useMemo<Array<{ key: Tab; label: string }>>(
    () => [
      { key: 'library', label: 'Library' },
      { key: 'link', label: 'Paste link' },
      ...(GIPHY_KEY ? [{ key: 'search' as Tab, label: 'Search' }] : []),
    ],
    [],
  );

  // Every distinct GIF already used in a comment — the app's own shared set.
  const { data: library, isLoading } = useQuery({
    queryKey: ['gif-library'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('social_post_comments')
        .select('gif_url, created_at')
        .not('gif_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(120);
      if (error) throw error;
      const seen = new Set<string>();
      const out: GifResult[] = [];
      for (const r of (data ?? []) as any[]) {
        if (!r.gif_url || seen.has(r.gif_url)) continue;
        seen.add(r.gif_url);
        out.push({ id: r.gif_url, url: r.gif_url, preview: r.gif_url, description: 'GIF' });
      }
      return out;
    },
    enabled: visible,
    staleTime: 60_000,
  });

  const { data: searchResults, isFetching: searching } = useQuery({
    queryKey: ['gif-search', query],
    queryFn: () => searchGiphy(query),
    enabled: visible && tab === 'search' && !!GIPHY_KEY,
    staleTime: 60_000,
  });

  const trimmedLink = link.trim();
  const linkValid = /^https?:\/\/\S+$/i.test(trimmedLink);

  function pickLink() {
    if (!linkValid) return;
    onSelect({ id: trimmedLink, url: trimmedLink, preview: trimmedLink, description: 'GIF' });
    setLink('');
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22,
            paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20, height: '72%', gap: 12,
          }}
        >
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: 40, height: 5, borderRadius: 100, backgroundColor: theme.hairline2 }} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, color: theme.ink }}>Add a GIF</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close GIF picker">
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.muted} strokeWidth={2.2} strokeLinecap="round">
                <Path d="M18 6 6 18M6 6l12 12" />
              </Svg>
            </Pressable>
          </View>

          {/* Source tabs */}
          <View style={{ flexDirection: 'row', height: 36, borderRadius: 100, backgroundColor: theme.surfaceSunken, overflow: 'hidden' }}>
            {tabs.map((t) => {
              const active = tab === t.key;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={{
                    flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 100,
                    backgroundColor: active ? theme.surface : 'transparent',
                    borderWidth: active ? 1 : 0, borderColor: theme.hairline,
                  }}
                >
                  <Text style={{ fontFamily: active ? FONT.sansMedium : FONT.sans, fontSize: 13, color: active ? theme.ink : theme.muted }}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {tab === 'link' ? (
            <View style={{ gap: 12, paddingTop: 4 }}>
              <Text style={{ fontFamily: FONT.sans, fontSize: 13, lineHeight: 19, color: theme.muted }}>
                Paste a link to any GIF — a Giphy or Tenor share link, an Imgur URL, or a file in
                your own storage bucket.
              </Text>
              <TextInput
                value={link}
                onChangeText={setLink}
                placeholder="https://…/reaction.gif"
                placeholderTextColor={theme.muted2}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                accessibilityLabel="GIF URL"
                style={{
                  height: 46, borderRadius: 10, paddingHorizontal: 12,
                  backgroundColor: theme.surfaceSunken, color: theme.ink,
                  fontFamily: FONT.sans, fontSize: 15,
                }}
              />
              {linkValid ? (
                <Image
                  source={{ uri: trimmedLink }}
                  style={{ width: 140, height: 140, borderRadius: 12, backgroundColor: theme.surfaceSunken }}
                  resizeMode="cover"
                />
              ) : null}
              <Pressable
                onPress={pickLink}
                disabled={!linkValid}
                accessibilityLabel="Use this GIF"
                style={{
                  height: 46, borderRadius: 100, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: linkValid ? theme.ink : theme.surfaceSunken,
                }}
              >
                <Text style={{ fontFamily: FONT.sansMedium, fontSize: 15, color: linkValid ? theme.surface : theme.faint }}>
                  Use this GIF
                </Text>
              </Pressable>
            </View>
          ) : tab === 'search' ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 12, gap: 8, backgroundColor: theme.surfaceSunken, borderRadius: 10 }}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.muted2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
                  <Path d="m21 21-4.3-4.3" />
                </Svg>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search GIFs"
                  placeholderTextColor={theme.muted2}
                  autoCorrect={false}
                  accessibilityLabel="Search for a GIF"
                  style={{ flex: 1, padding: 0, fontFamily: FONT.sans, fontSize: 15, color: theme.ink }}
                />
              </View>
              <GifGrid theme={theme} gifs={searchResults ?? []} loading={searching} onSelect={onSelect} onClose={onClose} empty="No GIFs found." />
            </>
          ) : (
            <GifGrid
              theme={theme}
              gifs={library ?? []}
              loading={isLoading}
              onSelect={onSelect}
              onClose={onClose}
              empty="No GIFs used yet. Paste a link and it'll show up here for everyone."
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function GifGrid({
  theme, gifs, loading, onSelect, onClose, empty,
}: {
  theme: Theme; gifs: GifResult[]; loading: boolean;
  onSelect: (g: GifResult) => void; onClose: () => void; empty: string;
}) {
  if (loading && gifs.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  return (
    <FlatList
      data={gifs}
      keyExtractor={(g) => g.id}
      numColumns={2}
      columnWrapperStyle={{ gap: 8 }}
      contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <Pressable
          onPress={() => { onSelect(item); onClose(); }}
          accessibilityLabel={item.description}
          style={{ flex: 1, aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.surfaceSunken }}
        >
          <Image source={{ uri: item.preview }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        </Pressable>
      )}
      ListEmptyComponent={
        <Text style={{ fontFamily: FONT.sans, fontSize: 13, lineHeight: 20, color: theme.muted, textAlign: 'center', padding: 30 }}>
          {empty}
        </Text>
      }
    />
  );
}

/**
 * Optional provider search. Only reachable when EXPO_PUBLIC_GIPHY_API_KEY is
 * set — swap this one function to change providers.
 */
async function searchGiphy(query: string): Promise<GifResult[]> {
  if (!GIPHY_KEY) return [];
  const base = query.trim()
    ? `https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(query.trim())}`
    : 'https://api.giphy.com/v1/gifs/trending?';
  const res = await fetch(`${base}&api_key=${GIPHY_KEY}&limit=24&rating=pg-13`);
  if (!res.ok) throw new Error(`GIPHY responded ${res.status}`);
  const json = await res.json();
  return (json.data ?? [])
    .map((g: any) => ({
      id: String(g.id),
      url: g.images?.downsized?.url ?? g.images?.original?.url ?? '',
      preview: g.images?.fixed_width_small?.url ?? g.images?.downsized?.url ?? '',
      description: g.title || 'GIF',
    }))
    .filter((g: GifResult) => g.url && g.preview);
}
