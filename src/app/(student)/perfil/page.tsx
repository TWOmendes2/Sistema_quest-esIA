import { PageHeader } from '@/components/ui';
import { ProfileForm } from '@/components/profile-form';
import { getStudentProfileData } from '@/server/data/student';

export default async function ProfilePage() {
  const profile = await getStudentProfileData();
  return <><PageHeader eyebrow="Conta" title="Meu perfil" description="Gerencie os dados permitidos e consulte seus vínculos acadêmicos." /><ProfileForm profile={profile} /></>;
}
