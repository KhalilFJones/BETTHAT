import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, Modal, Image, FlatList,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path } from 'react-native-svg';

import { supabase } from '@/lib/supabase';
import { FONT } from '@/lib/holygrail';
import type { Theme } from '@/lib/theme';
import { GifPicker, type GifResult } from '@/components/social/GifPicker';
import { VoiceRecorderBar } from '@/components/media/VoiceRecorderBar';
import { VoiceNotePlayer } from '@/components/media/VoiceNotePlayer';
import { useVoiceNote } from '@/hooks/useVoiceNote';

// =============================================================================
// Comments on a post. Anyone signed in can comment on anyone's post, provided
// the author left comments enabled — that's enforced in RLS, so a post with
// allow_comments = false rejects the insert at the database rather than just
// hiding the button.
//
// A comment is text, a GIF, or both, and can reply to another comment
// (parent_id) — replies render indented under their parent.
// =============================================================================

const MAX_COMMENT = 1000;

interface CommentRow {
  id: string;
  body: string | null;
  gif_url: string | null;
  audio_url: string | null;
  audio_duration_ms: number | null;
  parent_id: string | null;
  created_at: string;
  user_id: string;
  author: { id: string; username: string; display_name: string | null; avatar_url: string | null } | null;
}

export function CommentsSheet({
  theme, visible, postId, allowComments, meId, onClose, onChanged,
}: {
  theme: Theme; visible: boolean; postId: string | null; allowComments: boolean;
  meId: string | undefined; onClose: () => void; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [gif, setGif] = useState<GifResult | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const voice = useVoiceNote();

  const { data: comments, isLoading } = useQuery({
    queryKey: ['post-comments', postId],
    queryFn: async () => {
      if (!postId) return [] as CommentRow[];
      const { data, error } = await supabase
        .from('social_post_comments')
        .select(`
          id, body, gif_url, audio_url, audio_duration_ms, parent_id, created_at, user_id,
          author:profiles!social_post_comments_user_id_fkey(id, username, display_name, avatar_url)
        `)
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as CommentRow[];
    },
    enabled: !!postId && visible,
  });

  const addMutation = useMutation({
    mutationFn: async (voiceNote?: { url: string; durationMs: number }) => {
      if (!meId || !postId) throw new Error('Not signed in');
      const body = text.trim();
      if (!body && !gif && !voiceNote) throw new Error('Write something, pick a GIF, or record a note');
      const { error } = await supabase.from('social_post_comments').insert({
        post_id: postId,
        user_id: meId,
        body: body || null,
        gif_url: gif?.url ?? null,
        audio_url: voiceNote?.url ?? null,
        audio_duration_ms: voiceNote?.durationMs ?? null,
        parent_id: replyTo?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setText('');
      setGif(null);
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: ['post-comments', postId] });
      onChanged();
    },
    onError: (err: any) => {
      // The RLS check is the source of truth for whether comments are open.
      const closed = /row-level security|violates/i.test(err?.message ?? '');
      Alert.alert(
        closed ? 'Comments are turned off' : 'Could not comment',
        closed ? 'The author turned off comments for this post.' : (err?.message ?? 'Try again.'),
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await supabase.from('social_post_comments').delete().eq('id', commentId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['post-comments', postId] });
      onChanged();
    },
    onError: (err: any) => Alert.alert('Could not delete', err?.message ?? 'Try again.'),
  });

  // Flatten to parents-with-replies so replies sit under the comment they answer.
  const all = comments ?? [];
  const threaded: Array<CommentRow & { depth: number }> = [];
  for (const c of all.filter((x) => !x.parent_id)) {
    threaded.push({ ...c, depth: 0 });
    for (const r of all.filter((x) => x.parent_id === c.id)) threaded.push({ ...r, depth: 1 });
  }

  const canSend = (text.trim().length > 0 || !!gif) && !addMutation.isPending;

  const sendVoiceNote = async () => {
    const note = await voice.upload();
    if (note) addMutation.mutate(note);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
      >
        {/* Backdrop and sheet share the column by flex ratio rather than a
            fixed percentage, so both shrink together as the keyboard opens. */}
        <Pressable onPress={onClose} accessibilityLabel="Close comments" style={{ flex: 1 }} />
        <View style={{ flex: 6, backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22 }}>
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 8 }}>
              <View style={{ width: 40, height: 5, borderRadius: 100, backgroundColor: theme.hairline2 }} />
            </View>
            <View style={{ paddingHorizontal: 20, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: FONT.sansBold, fontSize: 18, color: theme.ink }}>
                Comments{all.length ? ` · ${all.length}` : ''}
              </Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close comments">
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.muted} strokeWidth={2.2} strokeLinecap="round">
                  <Path d="M18 6 6 18M6 6l12 12" />
                </Svg>
              </Pressable>
            </View>

            {isLoading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={theme.accent} />
              </View>
            ) : (
              <FlatList
                data={threaded}
                keyExtractor={(c) => c.id}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 16 }}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <CommentRowView
                    theme={theme}
                    comment={item}
                    isMine={item.user_id === meId}
                    canReply={allowComments}
                    onReply={() => setReplyTo(item)}
                    onDelete={() => deleteMutation.mutate(item.id)}
                  />
                )}
                ListEmptyComponent={
                  <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted, textAlign: 'center', paddingVertical: 40 }}>
                    {allowComments ? 'No comments yet — say something.' : 'Comments are turned off for this post.'}
                  </Text>
                }
              />
            )}

            {/* Composer */}
            {allowComments ? (
              <View style={{ borderTopWidth: 1, borderColor: theme.hairline, padding: 12, gap: 8, paddingBottom: Platform.OS === 'ios' ? 24 : 12 }}>
                {replyTo ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.sans, fontSize: 12, color: theme.muted }}>
                      Replying to {replyTo.author?.display_name || replyTo.author?.username || 'comment'}
                    </Text>
                    <Pressable onPress={() => setReplyTo(null)} hitSlop={8} accessibilityLabel="Cancel reply">
                      <Text style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: theme.muted }}>Cancel</Text>
                    </Pressable>
                  </View>
                ) : null}

                {gif ? (
                  <View style={{ position: 'relative', alignSelf: 'flex-start' }}>
                    <Image source={{ uri: gif.preview }} style={{ width: 104, aspectRatio: 1.25, borderRadius: 12 }} resizeMode="cover" />
                    <Pressable
                      onPress={() => setGif(null)}
                      accessibilityLabel="Remove GIF"
                      style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 100, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round">
                        <Path d="M18 6 6 18M6 6l12 12" />
                      </Svg>
                    </Pressable>
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                  {voice.stage !== 'idle' ? null : (
                    <Pressable
                      onPress={() => setGifOpen(true)}
                      accessibilityLabel="Add a GIF"
                      style={{ width: 40, height: 40, borderRadius: 100, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceSunken, borderWidth: 1, borderColor: theme.hairline }}
                    >
                      <Text style={{ fontFamily: FONT.sansBold, fontSize: 11, color: theme.ink }}>GIF</Text>
                    </Pressable>
                  )}

                  <VoiceRecorderBar
                    theme={theme}
                    stage={voice.stage}
                    durationMs={voice.durationMs}
                    levels={voice.levels}
                    recordedUri={voice.recordedUri}
                    uploading={voice.uploading || addMutation.isPending}
                    onStart={voice.start}
                    onStop={voice.stop}
                    onSend={sendVoiceNote}
                    onDiscard={voice.discard}
                  />

                  {voice.stage !== 'idle' ? null : (
                  <TextInput
                    value={text}
                    onChangeText={setText}
                    placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
                    placeholderTextColor={theme.muted2}
                    multiline
                    maxLength={MAX_COMMENT}
                    accessibilityLabel="Comment text"
                    style={{
                      flex: 1, minHeight: 40, maxHeight: 110, borderRadius: 20,
                      paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
                      backgroundColor: theme.surfaceSunken, color: theme.ink,
                      fontFamily: FONT.sans, fontSize: 15, lineHeight: 20,
                    }}
                  />
                  )}

                  {voice.stage !== 'idle' ? null : (
                  <Pressable
                    onPress={() => addMutation.mutate(undefined)}
                    disabled={!canSend}
                    accessibilityLabel="Send comment"
                    style={{
                      width: 40, height: 40, borderRadius: 100, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: canSend ? theme.ink : theme.surfaceSunken,
                    }}
                  >
                    {addMutation.isPending ? (
                      <ActivityIndicator color={theme.surface} size="small" />
                    ) : (
                      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={canSend ? theme.surface : theme.muted2} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <Path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
                      </Svg>
                    )}
                  </Pressable>
                  )}
                </View>
              </View>
            ) : (
              <View style={{ borderTopWidth: 1, borderColor: theme.hairline, padding: 18, alignItems: 'center' }}>
                <Text style={{ fontFamily: FONT.sans, fontSize: 13, color: theme.muted }}>
                  The author turned off comments for this post.
                </Text>
              </View>
            )}
        </View>
      </KeyboardAvoidingView>

      <GifPicker theme={theme} visible={gifOpen} onClose={() => setGifOpen(false)} onSelect={setGif} />
    </Modal>
  );
}

function CommentRowView({
  theme, comment, isMine, canReply, onReply, onDelete,
}: {
  theme: Theme; comment: CommentRow & { depth: number }; isMine: boolean; canReply: boolean;
  onReply: () => void; onDelete: () => void;
}) {
  const name = comment.author?.display_name || comment.author?.username || 'Someone';
  return (
    <View style={{ flexDirection: 'row', gap: 10, marginLeft: comment.depth * 34 }}>
      {comment.author?.avatar_url ? (
        <Image source={{ uri: comment.author.avatar_url }} style={{ width: 32, height: 32, borderRadius: 9999 }} />
      ) : (
        <View style={{ width: 32, height: 32, borderRadius: 9999, backgroundColor: theme.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: FONT.sansBold, fontSize: 13, color: theme.ink }}>{name.charAt(0).toUpperCase()}</Text>
        </View>
      )}

      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text numberOfLines={1} style={{ fontFamily: FONT.sansMedium, fontSize: 14, color: theme.ink }}>{name}</Text>
          <Text style={{ fontFamily: FONT.sans, fontSize: 11, color: theme.muted2 }}>{relativeTime(comment.created_at)}</Text>
        </View>

        {comment.body ? (
          <Text style={{ fontFamily: FONT.sans, fontSize: 14, lineHeight: 20, color: theme.ink }}>{comment.body}</Text>
        ) : null}

        {comment.audio_url ? (
          <VoiceNotePlayer
            url={comment.audio_url}
            durationMs={comment.audio_duration_ms}
            theme={theme}
            compact
          />
        ) : null}

        {comment.gif_url ? (
          <Image
            source={{ uri: comment.gif_url }}
            style={{ width: 132, aspectRatio: 1.25, borderRadius: 12, backgroundColor: theme.surfaceSunken }}
            resizeMode="cover"
            accessibilityLabel="GIF reply"
          />
        ) : null}

        <View style={{ flexDirection: 'row', gap: 16 }}>
          {canReply && comment.depth === 0 ? (
            <Pressable onPress={onReply} hitSlop={6} accessibilityLabel={`Reply to ${name}`}>
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: theme.muted }}>Reply</Text>
            </Pressable>
          ) : null}
          {isMine ? (
            <Pressable onPress={onDelete} hitSlop={6} accessibilityLabel="Delete comment">
              <Text style={{ fontFamily: FONT.sansMedium, fontSize: 12, color: theme.danger }}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function relativeTime(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}
