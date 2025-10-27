

// ============================================
// App.tsx - React Native メインコード
// ============================================
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  TextInput,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Platform,
  NativeModules,
  NativeEventEmitter,
  PermissionsAndroid,
  DeviceEventEmitter,
} from 'react-native';
import { captureScreen } from 'react-native-view-shot';
import ImageManipulator from '@react-native-community/image-manipulator';
import Tesseract from 'tesseract.js';
import RNFS from 'react-native-fs';

const { OverlayModule } = NativeModules;

type Stats = {
  speed: { current: number; max: number };
  stamina: { current: number; max: number };
  power: { current: number; max: number };
  guts: { current: number; max: number };
  wisdom: { current: number; max: number };
};

type CalculatedResult = {
  individual: {
    speed: number;
    stamina: number;
    power: number;
    guts: number;
    wisdom: number;
  };
  total: number;
  rating: string;
};

export default function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [calculated, setCalculated] = useState<CalculatedResult | null>(null);
  const [distance, setDistance] = useState<'short' | 'mile' | 'middle' | 'long'>('middle');
  const [strategy, setStrategy] = useState<'nige' | 'senko' | 'sashi' | 'oikomi'>('nige');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);

  useEffect(() => {
    checkAndRequestPermissions();
    
    // 画面キャプチャイベントのリスナー
    const subscription = DeviceEventEmitter.addListener('CAPTURE_SCREEN', handleCaptureFromOverlay);
    
    return () => subscription.remove();
  }, []);

  // 権限チェックとリクエスト
  const checkAndRequestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        // ストレージ権限
        const storageGranted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
        );
        
        // オーバーレイ権限
        const hasOverlayPermission = await OverlayModule.checkOverlayPermission();
        setHasPermission(hasOverlayPermission);
        
        if (!hasOverlayPermission) {
          Alert.alert(
            'オーバーレイ権限が必要です',
            '他のアプリの上に表示するために権限を許可してください',
            [
              { text: 'キャンセル', style: 'cancel' },
              { 
                text: '設定を開く',
                onPress: () => OverlayModule.requestOverlayPermission()
              }
            ]
          );
        }
      } catch (err) {
        console.warn(err);
      }
    }
  };

  // オーバーレイサービスの開始
  const startOverlay = async () => {
    if (!hasPermission) {
      await checkAndRequestPermissions();
      return;
    }
    
    try {
      await OverlayModule.startOverlayService();
      setOverlayEnabled(true);
      Alert.alert('成功', 'オーバーレイが起動しました。ウマ娘を開いてください。');
    } catch (error) {
      Alert.alert('エラー', 'オーバーレイの起動に失敗しました');
      console.error(error);
    }
  };

  // オーバーレイサービスの停止
  const stopOverlay = async () => {
    try {
      await OverlayModule.stopOverlayService();
      setOverlayEnabled(false);
    } catch (error) {
      console.error(error);
    }
  };

  // オーバーレイからのキャプチャイベント処理
  const handleCaptureFromOverlay = async () => {
    await captureAndAnalyze();
  };

  // 画面キャプチャと解析
  const captureAndAnalyze = async () => {
    try {
      setLoading(true);
      
      // 画面全体をキャプチャ
      const uri = await captureScreen({
        format: 'png',
        quality: 1.0,
      });
      
      console.log('キャプチャ成功:', uri);
      setCapturedImage(uri);
      
      // OCR実行
      const extractedStats = await performOCR(uri);
      
      if (extractedStats) {
        setStats(extractedStats);
        const result = calculateEvaluation(extractedStats, distance, strategy);
        setCalculated(result);
      } else {
        Alert.alert('読み取り失敗', '手動で入力してください');
        setStats({
          speed: { current: 0, max: 0 },
          stamina: { current: 0, max: 0 },
          power: { current: 0, max: 0 },
          guts: { current: 0, max: 0 },
          wisdom: { current: 0, max: 0 },
        });
      }
      
      setLoading(false);
    } catch (error) {
      console.error('キャプチャエラー:', error);
      Alert.alert('エラー', '画面のキャプチャに失敗しました');
      setLoading(false);
    }
  };

  // OCR処理
  const performOCR = async (uri: string): Promise<Stats | null> => {
    try {
      // 画像の前処理
      const manipResult = await ImageManipulator.manipulate(
        uri,
        [{ resize: { width: 1080 } }],
        { compress: 1, format: 'PNG' }
      );

      // Tesseract.jsでOCR実行
      const { data: { text } } = await Tesseract.recognize(
        manipResult.uri,
        'eng+jpn',
        {
          logger: (m) => console.log(m),
        }
      );

      console.log('OCR結果:', text);

      // 数値の抽出
      const numbers = text.match(/\d{3,4}/g);
      
      if (!numbers || numbers.length < 10) {
        return null;
      }

      return {
        speed: { current: parseInt(numbers[0]), max: parseInt(numbers[1]) },
        stamina: { current: parseInt(numbers[2]), max: parseInt(numbers[3]) },
        power: { current: parseInt(numbers[4]), max: parseInt(numbers[5]) },
        guts: { current: parseInt(numbers[6]), max: parseInt(numbers[7]) },
        wisdom: { current: parseInt(numbers[8]), max: parseInt(numbers[9]) },
      };
    } catch (error) {
      console.error('OCRエラー:', error);
      return null;
    }
  };

  // 評価値計算
  const calculateEvaluation = (
    stats: Stats,
    distance: string,
    strategy: string
  ): CalculatedResult => {
    const distanceCoef = {
      short: { speed: 1.0, stamina: 0.5, power: 1.0, guts: 0.5, wisdom: 0.5 },
      mile: { speed: 1.0, stamina: 0.7, power: 1.0, guts: 0.7, wisdom: 0.7 },
      middle: { speed: 1.0, stamina: 1.0, power: 1.0, guts: 1.0, wisdom: 1.0 },
      long: { speed: 0.8, stamina: 1.2, power: 0.8, guts: 1.2, wisdom: 1.2 },
    };

    const strategyCoef = {
      nige: { speed: 1.2, stamina: 1.1, power: 1.0, guts: 1.0, wisdom: 0.9 },
      senko: { speed: 1.1, stamina: 1.0, power: 1.1, guts: 1.0, wisdom: 1.0 },
      sashi: { speed: 1.0, stamina: 1.0, power: 1.1, guts: 1.1, wisdom: 1.0 },
      oikomi: { speed: 0.9, stamina: 1.0, power: 1.2, guts: 1.2, wisdom: 1.1 },
    };

    const evaluation = {
      speed: stats.speed.current * distanceCoef[distance].speed * strategyCoef[strategy].speed,
      stamina: stats.stamina.current * distanceCoef[distance].stamina * strategyCoef[strategy].stamina,
      power: stats.power.current * distanceCoef[distance].power * strategyCoef[strategy].power,
      guts: stats.guts.current * distanceCoef[distance].guts * strategyCoef[strategy].guts,
      wisdom: stats.wisdom.current * distanceCoef[distance].wisdom * strategyCoef[strategy].wisdom,
    };

    const total = Math.round(
      evaluation.speed + evaluation.stamina + evaluation.power + evaluation.guts + evaluation.wisdom
    );

    const getRating = (total: number) => {
      if (total >= 6000) return 'SS';
      if (total >= 5500) return 'S';
      if (total >= 5000) return 'A+';
      if (total >= 4500) return 'A';
      if (total >= 4000) return 'B';
      return 'C';
    };

    return {
      individual: evaluation,
      total,
      rating: getRating(total),
    };
  };

  const handleStatChange = (stat: keyof Stats, field: 'current' | 'max', value: string) => {
    if (!stats) return;
    const newStats = {
      ...stats,
      [stat]: { ...stats[stat], [field]: parseInt(value) || 0 },
    };
    setStats(newStats);
    setCalculated(calculateEvaluation(newStats, distance, strategy));
  };

  const statLabels = {
    speed: 'スピード',
    stamina: 'スタミナ',
    power: 'パワー',
    guts: '根性',
    wisdom: '賢さ',
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>ウマ娘ステータス計算機</Text>
        <Text style={styles.subtitle}>オーバーレイモード</Text>
      </View>

      {/* オーバーレイ制御 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>オーバーレイ設定</Text>
        <TouchableOpacity
          style={[styles.mainButton, overlayEnabled && styles.mainButtonActive]}
          onPress={overlayEnabled ? stopOverlay : startOverlay}
        >
          <Text style={styles.mainButtonText}>
            {overlayEnabled ? '⏹ オーバーレイを停止' : '▶️ オーバーレイを起動'}
          </Text>
        </TouchableOpacity>
        
        {overlayEnabled && (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              ✅ オーバーレイが起動中です{'\n'}
              ウマ娘を開いて、浮遊ボタンから読み取ってください
            </Text>
          </View>
        )}
        
        {!hasPermission && (
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={checkAndRequestPermissions}
          >
            <Text style={styles.permissionButtonText}>権限を許可する</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* テスト用キャプチャボタン */}
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.testButton}
          onPress={captureAndAnalyze}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.testButtonText}>🧪 テストキャプチャ</Text>
          )}
        </TouchableOpacity>
      </View>

      {capturedImage && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>キャプチャ画像</Text>
          <Image source={{ uri: capturedImage }} style={styles.capturedImage} />
        </View>
      )}

      {stats && (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>レース条件</Text>
            
            <Text style={styles.label}>距離</Text>
            <View style={styles.buttonGroup}>
              {[
                { key: 'short', label: '短距離' },
                { key: 'mile', label: 'マイル' },
                { key: 'middle', label: '中距離' },
                { key: 'long', label: '長距離' },
              ].map((item) => (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.button, distance === item.key && styles.buttonActive]}
                  onPress={() => {
                    setDistance(item.key as any);
                    if (stats) {
                      setCalculated(calculateEvaluation(stats, item.key, strategy));
                    }
                  }}
                >
                  <Text style={[styles.buttonText, distance === item.key && styles.buttonTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>脚質</Text>
            <View style={styles.buttonGroup}>
              {[
                { key: 'nige', label: '逃げ' },
                { key: 'senko', label: '先行' },
                { key: 'sashi', label: '差し' },
                { key: 'oikomi', label: '追込' },
              ].map((item) => (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.button, strategy === item.key && styles.buttonActive]}
                  onPress={() => {
                    setStrategy(item.key as any);
                    if (stats) {
                      setCalculated(calculateEvaluation(stats, distance, item.key));
                    }
                  }}
                >
                  <Text style={[styles.buttonText, strategy === item.key && styles.buttonTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ステータス</Text>
            {Object.entries(stats).map(([key, value]) => (
              <View key={key} style={styles.statRow}>
                <Text style={styles.statLabel}>{statLabels[key as keyof Stats]}</Text>
                <View style={styles.statInputContainer}>
                  <TextInput
                    style={styles.statInput}
                    value={value.current.toString()}
                    onChangeText={(text) => handleStatChange(key as keyof Stats, 'current', text)}
                    keyboardType="numeric"
                  />
                  <Text>/</Text>
                  <TextInput
                    style={styles.statInput}
                    value={value.max.toString()}
                    onChangeText={(text) => handleStatChange(key as keyof Stats, 'max', text)}
                    keyboardType="numeric"
                  />
                </View>
              </View>
            ))}
          </View>

          {calculated && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>評価結果</Text>
              <View style={styles.resultCard}>
                <Text style={styles.rating}>{calculated.rating}</Text>
                <Text style={styles.totalScore}>総合: {calculated.total}</Text>
                <View style={styles.individualScores}>
                  {Object.entries(calculated.individual).map(([key, value]) => (
                    <View key={key} style={styles.individualScore}>
                      <Text style={styles.individualLabel}>{statLabels[key as keyof Stats]}</Text>
                      <Text style={styles.individualValue}>{Math.round(value)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  header: {
    backgroundColor: '#8B5CF6',
    padding: 24,
    paddingTop: 60,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 14,
    color: '#E9D5FF',
    marginTop: 4,
  },
  section: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    padding: 20,
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#1F2937',
  },
  mainButton: {
    backgroundColor: '#10B981',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  mainButtonActive: {
    backgroundColor: '#EF4444',
  },
  mainButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  testButton: {
    backgroundColor: '#3B82F6',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  testButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  permissionButton: {
    backgroundColor: '#F59E0B',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  infoBox: {
    backgroundColor: '#DBEAFE',
    padding: 16,
    borderRadius: 8,
    marginTop: 12,
  },
  infoText: {
    fontSize: 14,
    color: '#1E40AF',
    lineHeight: 20,
  },
  capturedImage: {
    width: '100%',
    height: 300,
    borderRadius: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
    marginBottom: 8,
  },
  buttonGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
  },
  buttonActive: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  buttonText: {
    fontSize: 14,
    color: '#374151',
  },
  buttonTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    padding: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
  },
  statLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    width: 100,
  },
  statInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    width: 80,
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    backgroundColor: '#FFFFFF',
  },
  resultCard: {
    backgroundColor: '#F3F4F6',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  rating: {
    fontSize: 64,
    fontWeight: 'bold',
    color: '#8B5CF6',
    marginBottom: 8,
  },
  totalScore: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 20,
  },
  individualScores: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  individualScore: {
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  individualLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  individualValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
  },
});