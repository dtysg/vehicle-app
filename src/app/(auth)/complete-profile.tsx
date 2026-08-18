import { Redirect } from 'expo-router';

// 简码登录模式下不需要补填个人信息，直接跳转到主页
export default function CompleteProfileScreen() {
  return <Redirect href="/(app)/home" />;
}
