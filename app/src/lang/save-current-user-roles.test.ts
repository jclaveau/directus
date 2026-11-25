import { expect, test } from 'vitest';

// The special stamps every role the user holds: a locale states it in the
// plural, or leaves the key out and falls back to en-US.
test('each locale names the roles save_current_user_roles stamps', () => {
	const translationFiles = import.meta.glob<{
		default: Record<string, unknown>;
	}>('./translations/*.yaml', { eager: true });

	expect(Object.fromEntries(
		Object.entries(translationFiles)
			.filter(([, translationFile]) => {
				return translationFile.default.save_current_user_roles !== undefined;
			})
			.map(([filePath, translationFile]) => {
				return [
					filePath.replace('./translations/', '').replace('.yaml', ''),
					translationFile.default.save_current_user_roles,
				];
			}),
	)).toEqual({
		'ar-SA': 'احفظ أدوار المستخدم الحالي',
		'bg-BG': 'Запазване на ролите на текущия потребител',
		'bs-BA': 'Sačuvaj role trenutnog korisnika',
		'ca-ES': 'Desa els rols de l\'usuari actual',
		'cs-CZ': 'Uložit role aktuálního uživatele',
		'da-DK': 'Gem nuværende brugers roller',
		'de-DE': 'Aktuelle Benutzerrollen speichern',
		'en-CA': 'Save Current User Roles',
		'en-GB': 'Save Current User Roles',
		'en-US': 'Save Current User Roles',
		'es-419': 'Guardar Roles Actuales de Usuario',
		'es-CL': 'Guardar Roles Actuales de Usuario',
		'es-ES': 'Guardar Roles Actuales de Usuario',
		'es-MX': 'Guardar Roles Actuales de Usuario',
		'et-EE': 'Salvesta praeguse kasutaja rollid',
		'fa-IR': 'ذخیره نقش‌های کاربر فعلی',
		'fi-FI': 'Tallenna nykyisen käyttäjän roolit',
		'fr-CA': 'Enregistrer les rôles de l\'utilisateur actuel',
		'fr-FR': 'Enregistrer les rôles de l\'utilisateur actuel',
		'hr-HR': 'Spremi uloge trenutnog korisnika',
		'hu-HU': 'Jelenlegi felhasználó szerepköreinek mentése',
		'id-ID': 'Simpan Semua Peran Pengguna Saat Ini',
		'it-IT': 'Salva Ruoli Utente Attuale',
		'ja-JP': '現在のユーザーの全ロールを保存',
		'ka-GE': 'მიმდინარე მომხმარებლის როლების შენახვა',
		'ko-KR': '현재 사용자 역할(role) 모두 저장',
		'lt-LT': 'Išsaugoti dabartinio vartotojo grupes',
		'nl-NL': 'Huidige gebruikersrollen opslaan',
		'pl-PL': 'Zapisz bieżące role użytkownika',
		'pt-BR': 'Salvar as Funções do Usuário Atual',
		'pt-PT': 'Salvar as funções do usuário atual',
		'ro-RO': 'Salvează rolurile utilizatorului curent',
		'ru-RU': 'Сохранить роли текущего пользователя',
		'sk-SK': 'Uložiť roly aktuálneho používateľa',
		'sl-SI': 'Shrani vloge trenutnega uporabnika',
		'sq-AL': 'Ruaj Rolet e Përdoruesit Aktual',
		'sr-CS': 'Sačuvaj Trenutne Korisničke Uloge',
		'sv-SE': 'Spara aktuella användarroller',
		'th-TH': 'บันทึกบทบาททั้งหมดของผู้ใช้ปัจจุบัน',
		'tr-TR': 'Mevcut Kullanıcı Rollerini Kaydet',
		'uk-UA': 'Зберегти поточні ролі користувача',
		'zh-CN': '保存当前用户的所有角色',
		'zh-TW': '儲存當前使用者的所有角色',
	});
});
