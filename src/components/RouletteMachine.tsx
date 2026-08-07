import { Text, View } from 'react-native';

import { OOTIQUE_COLORS } from '../domain';
import { t } from '../i18n';
import { THEME, styles } from '../theme';

export function RouletteMachine({ color }: { color?: string }) {
  return (
    <View accessibilityLabel={t('today.rouletteLabel')} style={styles.machineShell}>
      <View style={styles.machineLabel}>
        <Text style={styles.machineLabelText}>✦ COLOR ROULETTE MACHINE ✦</Text>
      </View>
      <View style={styles.reelWindow}>
        {OOTIQUE_COLORS.slice(0, 8).map((item) => (
          <View key={item.id} style={[styles.reel, { backgroundColor: item.hex }]} />
        ))}
        <View style={styles.selector}>
          <View style={[styles.selectorColor, { backgroundColor: color ?? THEME.surface }]} />
        </View>
      </View>
      <View style={styles.machineControls}>
        <View style={styles.smallLight} />
        <View style={[styles.smallLight, { backgroundColor: THEME.yellow }]} />
        <View style={styles.speaker}>
          <View style={styles.speakerLine} />
          <View style={styles.speakerLine} />
          <View style={styles.speakerLine} />
        </View>
        <View style={styles.dial} />
      </View>
    </View>
  );
}

