import { View, Text } from 'react-native';
import { FONT } from '@/lib/holygrail';
import { useTheme } from '@/lib/theme';

interface Props {
  /** First word in DM Serif (regular). */
  word: string;
  /** Word(s) shown in italic serif at muted color. Optional. */
  emphasis?: string;
  /** Right-aligned mono label. e.g. "Last 4h". Optional. */
  label?: string;
  /** True puts emphasis BEFORE word. Default: emphasis after word. */
  emphasisFirst?: boolean;
}

// Holy Grail section header. DM Serif Display, with one word italicised in
// muted color for tonal contrast. Right side carries an optional Plex Mono
// eyebrow label (e.g. "Last 4h", "Tonight", "49 players").
export function SectionHead({ word, emphasis, label, emphasisFirst }: Props) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 18,
        paddingTop: 22,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
      }}
    >
      <Text style={{ fontFamily: FONT.serif, fontSize: 22, color: theme.ink, letterSpacing: -0.2, lineHeight: 24 }}>
        {emphasisFirst && emphasis ? (
          <>
            <Text style={{ fontFamily: FONT.serifItalic, color: theme.muted }}>{emphasis}</Text>{' '}
            {word}
          </>
        ) : (
          <>
            {word}{emphasis ? ' ' : ''}
            {emphasis ? <Text style={{ fontFamily: FONT.serifItalic, color: theme.muted }}>{emphasis}</Text> : null}
          </>
        )}
      </Text>
      {label ? (
        <Text style={{ fontFamily: FONT.monoMedium, fontSize: 10, letterSpacing: 1.8, color: theme.muted, textTransform: 'uppercase' }}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}
