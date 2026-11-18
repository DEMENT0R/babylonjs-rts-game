// Интернационализация: точечные ключи ('hud.credits'), словари по модулям.
// Язык хранится в localStorage; переключение применяется перезагрузкой
// страницы, потому что строки вшиты в разметку экранов, а не в один список.

import { ru as configRu, en as configEn } from './config.js';
import { ru as missionsRu, en as missionsEn } from './missions.js';
import { ru as uiRu, en as uiEn } from './ui.js';
import { ru as gameRu, en as gameEn } from './game.js';

const LANG_KEY = 'gelios.lang.v1';

// Названия языков показываются на самом языке — это нормально для переключателя.
export const LANGS = [
  { value: 'ru', label: 'РУССКИЙ' },
  { value: 'en', label: 'ENGLISH' },
];

const DICTS = {
  ru: Object.assign({}, configRu, missionsRu, uiRu, gameRu),
  en: Object.assign({}, configEn, missionsEn, uiEn, gameEn),
};

let lang = 'ru';

export function loadLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ru' || saved === 'en') lang = saved;
  } catch {
    // localStorage может быть недоступен — остаёмся на русском.
  }
  return lang;
}

// Читаем сохранённый язык сразу при загрузке модуля: словарные вызовы на
// этапе оценки других модулей (данные миссий, названия техники) должны уже
// видеть выбранный язык, а не умолчание.
loadLang();
export function getLang() {
  return lang;
}

/** Возвращает true, если язык действительно сменился (перезагрузку делает вызвавший). */
export function setLang(value) {
  if (value !== 'ru' && value !== 'en') return false;
  if (lang === value) return false;
  lang = value;
  try {
    localStorage.setItem(LANG_KEY, value);
  } catch {
    // Сохранить не выйдет — но текущую сессию всё равно переключаем.
  }
  return true;
}

/**
 * Текст по ключу; параметры подставляются как {name}. Отсутствующий ключ
 * виден в интерфейсе как сам ключ — так пропуски находятся сразу.
 */
export function t(key, params) {
  let text = DICTS[lang][key] ?? DICTS.ru[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/**
 * Статические подписи из index.html: data-i18n — текст элемента,
 * data-i18n-aria и data-i18n-title — атрибуты. Вызывается один раз на старте,
 * до создания игровых экранов.
 */
export function applyStatic() {
  document.documentElement.lang = lang;
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
}
