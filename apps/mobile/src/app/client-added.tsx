// Client added (CF04 design §2.4, C-D31 proposed).
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { AuthLayout, Banner, Heading, IconTile, PrimaryButton, SecondaryButton } from '../components/ui';
import { CLIENT_TEXTS } from '../clients/texts';

export default function ClientAdded() {
  const { name, waiting, noEmail } = useLocalSearchParams<{ name?: string; waiting?: string; noEmail?: string }>();
  const router = useRouter();
  return (
    <AuthLayout
      footer={
        <>
          <PrimaryButton label="Back to clients" arrow onPress={() => router.replace('/clients')} />
          <SecondaryButton label="Add another" onPress={() => router.replace('/client-add')} />
        </>
      }
    >
      <View style={{ marginTop: 32 }}>
        <IconTile name="mail" tone="success" />
      </View>
      {noEmail ? (
        <View style={{ marginTop: 16 }}>
          <Banner kind="info">{CLIENT_TEXTS.addedNoEmail}</Banner>
        </View>
      ) : null}
      <Heading first="Client" second="added" sub={waiting ? CLIENT_TEXTS.addedWaitingSub(name ?? 'They') : CLIENT_TEXTS.addedSub(name ?? 'They')} />
    </AuthLayout>
  );
}
