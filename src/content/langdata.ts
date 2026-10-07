// Static word lists shared by the content script (language detection,
// context checks) and scripts/build-dicts.mjs (function words are never
// translated). Plain data only, so Node can import this file directly.

export type SourceLang = 'en' | 'de' | 'fr' | 'es';
export const SOURCE_LANGS: readonly SourceLang[] = ['en', 'de', 'fr', 'es'];

/** Languages the detector knows. Only SOURCE_LANGS are translated; the rest exist so they are not mistaken for one. */
export type DetectLang = SourceLang | 'sv' | 'nl' | 'it' | 'pt' | 'da' | 'nb';

const words = (s: string): string[] => s.trim().split(/\s+/);

/** High-frequency function words per language, used as detection evidence. */
export const STOPWORDS: Record<DetectLang, string[]> = {
  en: words(`
    the of and to a in is it that was for on are with as be at by this have from or had not but
    what all were when we there can an your which their said if do will each about how up out
    them then she many some so these would other into has more her him could no than been its
    who now my over did down only you he i they our should because through after before while
    where why just very those between under any me us also does being here off again once
    both few most such own same too can't don't won't isn't one
  `),
  de: words(`
    der die und in den von zu das mit sich des auf für ist im dem nicht ein eine als auch es an
    werden aus er hat dass sie nach wird bei einer um am sind noch wie einem über einen so zum
    war haben nur oder aber vor zur bis mehr durch man sein wurde sei kann gegen vom können
    schon wenn habe seine ihre dann unter wir soll ich eines worden diese dieser keine weil ob
    hier jetzt sehr immer wurden waren ihr uns mich mir ihm ihn wo was wer doch nun also
    zwischen ohne ganz denn dieses wieder etwa sondern seit beim ins kein heute
  `),
  fr: words(`
    le la les de des du un une et est en que qui dans pour pas au aux sur ne se ce il elle ils
    elles nous vous je tu on avec par plus mais ou son sa ses leur leurs sont été être avoir a
    ont était fait comme tout tous cette ces cet aussi bien sans peut très entre après avant
    encore même où dont lui y mon ma mes notre nos votre vos quand alors donc ni car si sous
    chez depuis contre ici déjà toujours jamais rien qu c d l j n s m t toute toutes cela ça
  `),
  es: words(`
    el la los las de del y en que un una unos unas es son por para con no se su sus al lo como
    más pero le ya o este esta estos estas ese esa sí porque muy sin sobre también me hasta
    hay donde quien desde todo nos durante todos uno les ni contra otros eso ante ellos e esto
    antes algunos qué yo otro otras otra él tanto mucho quienes nada muchos cual poco ella
    estar algunas algo nosotros mi mis tú te ti tu tus ellas cuando entre era fue ha han
    había está están ser sido cada aunque mientras según tras
  `),
  sv: words(`
    och i att det som en på är av för med till den har de inte om ett han men var jag sig från
    vi så kan man när också efter eller nu sin där vid mot ska skulle kommer ut får finns vara
    hade alla andra mycket än dig honom hon henne oss dem deras hans hennes mitt min mina din
    dina vår våra detta denna dessa under över utan mellan sedan redan bara något några inga
    ingen varit blir blev vad vem hur varför eftersom medan även dock samt inom igen aldrig
    alltid hos dessutom kunde måste
  `),
  nl: words(`
    de het een van en in is dat op te zijn voor met die niet aan er om ook als bij of door naar
    maar uit wordt worden nog dan ze wel deze hij kan zich tot wat werd meer hun over zo ik je
    we wij hebben heeft had waren was onder tegen geen al nu toen hier daar zij mijn ons haar
    hem zou moet kunnen veel omdat alleen wie waar hoe
  `),
  it: words(`
    il di che è e la per un in del della non una sono le con si da i gli al dei delle lo come
    anche nel nella più ma ha alla questo questa ci se sua suo loro essere stato tra fra dopo
    molto era hanno quando sul sulla degli dal dalla cui quale perché ancora già sempre mai
    tutto tutti ogni io lui lei noi voi mi ti ne quello quella cosa così poi dove chi
  `),
  pt: words(`
    o a os as de do da dos das e em no na nos nas um uma que é para com não por se mais como
    mas foi ao ele ela seu sua ou ser quando muito há já está eu também só pelo pela até isso
    entre era depois sem mesmo aos ter seus quem me esse eles estão você tinha foram essa num
    nem suas meu às minha têm numa pelos elas havia seja qual será nós tenho lhe deles essas
    esses pelas este fosse dele são então ainda aqui onde porque
  `),
  da: words(`
    og i at det er en til på af for med den de som ikke har et var han jeg men fra vi der kan
    sig om så efter også eller nu hun ved mod skal skulle kommer ud får være havde alle andre
    meget end dig ham hende os dem deres hans hendes min mine din dine vores jeres dette denne
    disse under over uden mellem siden allerede bare noget nogle ingen været bliver blev hvad
    hvem hvordan hvorfor fordi mens dog samt igen aldrig altid hvor når blive
  `),
  nb: words(`
    og i det er en til på av for med den de som ikke har et var han jeg men fra vi der kan seg
    om så etter også eller nå hun ved mot skal skulle kommer ut får være hadde alle andre mye
    enn deg ham henne oss dem deres hans hennes min mine din dine vår våre dette denne disse
    under over uten mellom siden allerede bare noe noen ingen vært blir ble hva hvem hvordan
    hvorfor fordi mens dog samt igjen aldri alltid hvor når bli
  `),
};

/**
 * Words after which a noun reading is very likely: articles, possessives,
 * quantifiers, numerals and prepositions. Nouns that are also common verb
 * forms (flag "d" in the dictionary) are only replaced right after one of
 * these, optionally with one known adjective in between.
 */
export const NOUN_CONTEXT: Record<SourceLang, string[]> = {
  // Left out because a verb follows them as often: this/that/which/what (pronouns,
  // "things that need"), all/both ("we all want"), one ("no one knows"), her ("let her work").
  en: words(`
    the a an these those my your his its our their some any no every each many
    much more most few several another other such whose two three
    four five six seven eight nine ten hundred thousand of in on at for with from by about
    into without under over through between after before during against among
  `),
  de: words(`
    der die das den dem des ein eine einen einem einer eines kein keine keinen keinem keiner
    mein meine meinen meinem meiner dein deine sein seine seinen seinem seiner ihr ihre ihren
    ihrem ihrer unser unsere euer eure dieser diese dieses diesen diesem jeder jede jedes
    jeden jedem alle viele einige mehrere zwei drei vier fünf zehn hundert tausend in im mit
    von vom zu zum zur auf für aus bei nach über unter vor durch ohne gegen am ins beim
  `),
  fr: words(`
    le la les l un une des du de d au aux ce cet cette ces mon ma mes ton ta tes son sa ses
    notre nos votre vos leur leurs quelques chaque plusieurs aucun aucune tout toute tous
    toutes en dans sur sous avec pour par sans chez entre vers deux trois quatre cinq dix cent
    mille certains certaines autre autres
  `),
  // "lo" is left out: it comes before adjectives ("lo bueno") and participles ("lo hecho"), and is a pronoun.
  es: words(`
    el la los las un una unos unas del al de este esta estos estas ese esa esos esas aquel
    aquella aquellos aquellas mi mis tu tus su sus nuestro nuestra nuestros nuestras vuestro
    vuestra vuestros vuestras cada algún alguna algunos algunas ningún ninguna mucho mucha
    muchos muchas poco poca pocos pocas varios varias otro otra otros otras todo toda todos
    todas en con sin por para sobre entre hacia desde dos tres cuatro cinco diez cien mil
  `),
};

/**
 * Articles that are also object pronouns ("je l'aime", "il les voit", "yo la quiero").
 * After one of PRONOUN_CUES they introduce a verb, not a noun.
 */
export const ARTICLE_PRONOUNS: Record<SourceLang, string[]> = {
  en: [],
  de: [],
  fr: words(`le la les l`),
  es: words(`la los las`),
};

/** Subject pronouns, negation and other clitics that put an object pronoun before the verb. */
export const PRONOUN_CUES: Record<SourceLang, string[]> = {
  en: [],
  de: [],
  fr: words(`je j tu il elle on nous vous ils elles ne n me m te t se s`),
  es: words(`yo tú él ella usted nosotros nosotras vosotros vosotras ellos ellas ustedes no me te se nos os`),
};

/** German titles before a surname ("Herr Fischer", "Frau Koch"): the next word is a name, not a noun. */
export const NAME_TITLES = words(`
  Herr Herrn Frau Dr Prof Professor Professorin Familie Onkel Tante Sankt St Kollege Kollegin
  Minister Ministerin Kanzler Kanzlerin Präsident Präsidentin Bürgermeister Bürgermeisterin
`);

/** French/Spanish/English elision prefixes split off before lookup (l'homme -> l' + homme). */
export const ELISIONS: Record<SourceLang, string[]> = {
  en: [],
  de: [],
  fr: words(`l d j m n s t c qu jusqu lorsqu puisqu quoiqu`),
  es: [],
};
