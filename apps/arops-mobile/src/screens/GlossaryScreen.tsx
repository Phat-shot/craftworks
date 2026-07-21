import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { GAME_MODE_PROFILES, PLAYER_TYPE_PROFILES, GLOSSARY } from '@craftworks/arops-shared';
import Icon, { IconName } from '../components/Icon';

// Read-only reference screen — pure display of the Steckbrief "database"
// (packages/arops-shared/src/profiles.ts), no gameplay logic. Reachable as a
// 3rd equal-weight main menu button (see App.tsx), same as "Spiel hosten"/
// "Lobby beitreten" — browsing modes/classes/terms isn't tied to any lobby.
type Tab = 'modes' | 'classes' | 'terms';

const MODE_ICON: Record<string, IconName> = {
  hide_and_seek: 'ghost', domination: 'target', ctf: 'flag', seek_destroy: 'bomb', deathmatch: 'skull',
};
const CLASS_ICON: Record<string, IconName> = {
  hider: 'ghost', seeker: 'flashlight', team_member: 'people',
  scout: 'crosshair', sniper: 'target', bomber: 'bomb',
};

function ExpandCard({ icon, title, subtitle, children }: {
  icon: IconName; title: string; subtitle: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={st.card}>
      <TouchableOpacity style={st.cardHeader} onPress={() => setOpen(o => !o)}>
        <Icon name={icon} size={18} color="#f0c840" />
        <View style={{ flex: 1 }}>
          <Text style={st.cardTitle}>{title}</Text>
          <Text style={st.cardSubtitle} numberOfLines={open ? undefined : 2}>{subtitle}</Text>
        </View>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} color="#807050" />
      </TouchableOpacity>
      {open && <View style={st.cardBody}>{children}</View>}
    </View>
  );
}

export default function GlossaryScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('modes');
  const modes = Object.values(GAME_MODE_PROFILES);
  const classes = Object.values(PLAYER_TYPE_PROFILES);

  return (
    <View style={st.wrap}>
      <View style={st.header}>
        <TouchableOpacity onPress={onBack} style={st.backBtn}>
          <Icon name="arrowRight" size={18} color="#c0a0f0" style={{ transform: [{ rotate: '180deg' }] }} />
        </TouchableOpacity>
        <Icon name="book" size={18} color="#f0c840" />
        <Text style={st.headerTitle}>Glossar</Text>
      </View>

      <View style={st.tabRow}>
        {([['modes', 'Modi'], ['classes', 'Klassen'], ['terms', 'Begriffe']] as const).map(([id, label]) => (
          <TouchableOpacity key={id} style={[st.tabBtn, tab === id && st.tabBtnActive]} onPress={() => setTab(id)}>
            <Text style={[st.tabTxt, tab === id && st.tabTxtActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 32 }}>
        {tab === 'modes' && modes.map(m => (
          <ExpandCard key={m.id} icon={MODE_ICON[m.id] || 'target'} title={m.name} subtitle={m.shortDescription}>
            <Text style={st.longText}>{m.longDescription}</Text>
            {m.submodes.length > 0 && (
              <View style={{ marginTop: 10 }}>
                <Text style={st.sectionLabel}>Varianten</Text>
                {m.submodes.map(sm => (
                  <View key={sm.id} style={st.subRow}>
                    <Text style={st.subName}>{sm.name}</Text>
                    <Text style={st.subDesc}>{sm.shortDescription}</Text>
                  </View>
                ))}
              </View>
            )}
            <View style={{ marginTop: 10 }}>
              <Text style={st.sectionLabel}>Einstellungen</Text>
              {m.parameters.map(p => (
                <View key={p.key} style={st.paramRow}>
                  <Text style={st.paramName}>{p.name} <Text style={st.paramUnit}>({p.unit})</Text></Text>
                  <Text style={st.paramDesc}>{p.description}</Text>
                </View>
              ))}
            </View>
          </ExpandCard>
        ))}

        {tab === 'classes' && classes.map(c => (
          <ExpandCard key={c.id} icon={CLASS_ICON[c.id] || 'shieldAccount'} title={c.name} subtitle={c.shortDescription}>
            <View style={st.statRow}>
              <Text style={st.statLabel}>Reichweite:</Text>
              <Text style={st.statValue}>{c.shotRangeMultiplier === 0 ? 'kann nicht schießen' : `${c.shotRangeMultiplier}× Standard`}</Text>
            </View>
            <View style={st.statRow}>
              <Text style={st.statLabel}>Schusskegel:</Text>
              <Text style={st.statValue}>
                {c.shotWidth === 'shotgun_45deg' ? 'Breit (~45°)'
                  : c.shotWidth === 'melee_2m' ? 'Eng, distanzunabhängig (~2m)'
                  : c.shotWidth === 'omni_360deg' ? 'Rundum (360°)' : 'Durch Wände'}
              </Text>
            </View>
            {c.uniquePerks.length > 0 && (
              <View style={st.statRow}>
                <Text style={st.statLabel}>Exklusiv-Perks:</Text>
                <Text style={st.statValue}>{c.uniquePerks.join(', ')}</Text>
              </View>
            )}
          </ExpandCard>
        ))}

        {tab === 'terms' && GLOSSARY.map(g => (
          <View key={g.term} style={st.termRow}>
            <Text style={st.termName}>{g.term}</Text>
            <Text style={st.termDef}>{g.definition}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0a0810' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, paddingTop: 20 },
  backBtn: { padding: 4, marginRight: 2 },
  headerTitle: { color: '#f0c840', fontSize: 17, fontWeight: '900' },
  tabRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, marginBottom: 4 },
  tabBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
    backgroundColor: 'rgba(40,32,64,.6)', borderWidth: 1, borderColor: '#2a2040',
  },
  tabBtnActive: { borderColor: '#f0c840', backgroundColor: 'rgba(240,200,64,.15)' },
  tabTxt: { color: '#c0a0f0', fontSize: 12, fontWeight: '700' },
  tabTxtActive: { color: '#f0c840' },
  card: {
    backgroundColor: '#141020', borderRadius: 12, borderWidth: 1, borderColor: '#2a2040',
    marginBottom: 10, overflow: 'hidden',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  cardTitle: { color: '#f0f0f0', fontSize: 14, fontWeight: '800' },
  cardSubtitle: { color: '#a090c0', fontSize: 12, marginTop: 2 },
  cardBody: { paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: '#241c38' },
  longText: { color: '#c0b8d0', fontSize: 12, lineHeight: 18, marginTop: 10 },
  sectionLabel: { color: '#f0c840', fontSize: 11, fontWeight: '800', marginBottom: 6 },
  subRow: { marginBottom: 6 },
  subName: { color: '#e0d0f0', fontSize: 12, fontWeight: '700' },
  subDesc: { color: '#a090c0', fontSize: 11, lineHeight: 16 },
  paramRow: { marginBottom: 6 },
  paramName: { color: '#e0d0f0', fontSize: 12, fontWeight: '700' },
  paramUnit: { color: '#807050', fontWeight: '400' },
  paramDesc: { color: '#a090c0', fontSize: 11, lineHeight: 16 },
  statRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  statLabel: { color: '#807050', fontSize: 12, fontWeight: '700' },
  statValue: { color: '#e0d0f0', fontSize: 12, flexShrink: 1 },
  termRow: {
    backgroundColor: '#141020', borderRadius: 10, borderWidth: 1, borderColor: '#2a2040',
    padding: 12, marginBottom: 8,
  },
  termName: { color: '#f0c840', fontSize: 13, fontWeight: '800', marginBottom: 4 },
  termDef: { color: '#c0b8d0', fontSize: 12, lineHeight: 17 },
});
