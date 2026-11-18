// Словарь игровых модулей (game.js, entities.js, input.js, world.js, mapgen.js
// и остальных): уведомления, подсказки, статусы.

export const ru = {
  // --- цели и ход миссии (game.js)
  'game.objective.hq.intact': 'КП цел',
  'game.objective.hq.destroyed': 'КП уничтожен',
  'game.objective.timeLeft': '{time} осталось',
  'game.objective.done': 'Задача выполнена: {title}.',
  'game.kind.campaign': 'Операция',
  'game.kind.endless': 'Протокол',
  'game.kind.trial': 'Испытание',
  'game.mission.begin': '{kind} «{title}». {subtitle}',
  'game.mission.first': 'Задача: {title}. {desc}',

  // --- начало партии и подсказки
  'game.begin.link': 'Связь установлена. Командование колонией за вами.',
  'game.begin.hint': 'Постройте казармы и держите инженеров под рукой: без них стройка стоит.',
  'game.hint.oil': 'Нефтяные вышки приносят кредиты. Захватывайте нейтральные месторождения.',
  'game.hint.engineer': 'Здания строятся только рядом с инженерами. Чем их больше, тем быстрее.',
  'game.hint.enemy': 'Сенсоры фиксируют активность противника. Укрепляйте оборону.',
  'game.alert.base': 'Наша база под атакой!',

  // --- строительство, ремонт, продажа
  'game.build.started': 'Начато строительство: {name}',
  'game.build.requires': 'Сначала постройте: {names}.',
  'game.build.cancelled': 'Строительство отменено. Возвращено 60% стоимости.',
  'game.build.sold': '{name}: продано. Возвращено {refund} кредитов.',
  'game.build.noLink': 'Нет связи с системой строительства.',
  'game.repair.fullCost': '{started} Полный ремонт: {cost} кредитов.',

  // --- отряды и инженеры
  'game.group.empty': 'Сначала выберите юнитов или постройки для отряда.',
  'game.group.set': 'Отряд {index}: {count} {units}.',
  'game.idle.none': 'Свободных инженеров нет.',
  'game.idle.count': 'Свободные инженеры: {count} {units}.',
  'game.word.object': 'объект',
  'game.word.object.few': 'объекта',
  'game.word.object.many': 'объектов',
  'game.word.unit': 'юнит',
  'game.word.unit.few': 'юнита',
  'game.word.unit.many': 'юнитов',

  // --- приказы
  'game.order.patrol': 'Патруль: отряд будет ходить между текущей позицией и указанной точкой.',
  'game.order.hold': 'Отряд держит позицию и не будет преследовать врага.',

  // --- исследования и обучение
  'game.mission.buildBlocked': 'В этой операции такая постройка недоступна.',
  'game.mission.unitBlocked': 'В этой операции такой юнит недоступен.',
  'game.research.alreadyDone': 'Это улучшение уже изучено.',
  'game.research.alreadyQueued': 'Это улучшение уже исследуется.',
  'game.research.requiresLevel': 'Сначала изучите предыдущий уровень.',
  'game.research.started': 'Исследование начато: {name}.',
  'game.research.complete': 'Исследование завершено: {name}. {tail}',
  'game.research.scopeUnit': 'Отряд усилен.',
  'game.research.scopeBuilding': 'Постройки усилены.',
  'game.research.scopeGlobal': 'Эффект действует на всю колонию.',
  'game.train.locked': 'Требуется исследование «{name}».',

  // --- потери и уничтожение
  'game.friendlyFire': 'Залп РСЗО накрыл своих. Не стреляйте по своим войскам и зданиям.',
  'game.derrick.enemyDown': 'Нефтяная вышка противника уничтожена. Доход врага снижен.',
  'game.derrick.ownDown': 'Наша нефтяная вышка уничтожена.',
  'game.lost': 'Потеряно: {name}',
  'game.killed': 'Уничтожено: {name} противника',

  // --- числа (utils.js)
  'game.fmt.million': '{n} млн',
  'game.fmt.thousand': '{n} тыс',

  // --- юниты и здания (entities.js)
  'entity.rank': '{name}: ранг «{rank}».',
  'entity.build.done': 'Строительство завершено: {name}',

  // --- ввод и подсказки (input.js)
  'input.camera.base': 'Камера возвращена к базе.',
  'input.ghost.hint': 'Последнее известное положение постройки. Данные могли устареть.',
  'input.oil.info': 'Нефтяное месторождение. Постройте вышку, чтобы качать кредиты.',
  'input.builders.sent': 'Инженеры направлены к стройплощадке.',
  'input.oil.noCredits': 'Недостаточно кредитов для вышки.',
  'input.oil.laid': 'Нефтяная вышка заложена.',
  'input.hq.destroyed': 'Командный центр уничтожен. Строительство невозможно.',
  'input.mode.attack': 'Укажите точку атаки. ЛКМ — приказ, ПКМ — отмена.',
  'input.mode.patrol': 'Укажите точку патруля. ЛКМ — приказ, ПКМ — отмена.',
  'input.place.hint': 'Разместите: {name}. ЛКМ — построить, Shift+ЛКМ — ещё одно, ПКМ — отмена, R — повернуть.',

  // --- генератор карт (mapgen.js)
  'map.style.rot180.name': 'Центральная',
  'map.style.rot180.hint': 'Вторая половина карты — поворот первой на 180°.',
  'map.style.axis-x.name': 'Зеркальная',
  'map.style.axis-x.tag': 'ОСЬ X',
  'map.style.axis-x.hint': 'Базы стоят зеркально относительно оси X.',
  'map.style.axis-z.name': 'Зеркальная',
  'map.style.axis-z.tag': 'ОСЬ Z',
  'map.style.axis-z.hint': 'Базы стоят зеркально относительно оси Z.',
  'map.style.diagonal.name': 'Диагональная',
  'map.style.diagonal.hint': 'Базы стоят зеркально относительно диагонали X = Z.',
  'map.style.anti-diagonal.name': 'Диагональная',
  'map.style.anti-diagonal.hint': 'Базы стоят зеркально относительно диагонали X = −Z.',
  'map.palette.rust.name': 'РЖАВАЯ ПУСТОШЬ',
  'map.palette.basalt.name': 'БАЗАЛЬТОВЫЕ ПОЛЯ',
  'map.palette.ochre.name': 'ОХРИСТЫЕ ДЮНЫ',
  'map.palette.ash.name': 'ПЕПЕЛЬНАЯ ЗОНА',

  // --- уведомления противника (ai.js)
  'ai.msg.build': 'Сенсоры фиксируют новые постройки противника: он застраивает сектор.',
  'ai.msg.scoutSector': 'Разведка противника прощупывает сектор.',
  'ai.msg.retreatOutgunned': 'Отряд противника отходит: встретил превосходящие силы.',
  'ai.msg.retreatFailed': 'Отряд противника отступает: пробить оборону не удалось.',
  'ai.msg.starved': 'Противник экономит силы: его войска держатся у базы.',
  'ai.msg.hold': 'Противник оценил наши войска как более сильные и не решается наступать.',
  'ai.msg.gather': 'Противник стягивает силы: похоже, готовится крупный удар.',
  'ai.msg.waveFirst': 'Противник начал наступление на нашу базу!',
  'ai.msg.waveNext': 'Волна противника №{index} приближается!',
  'ai.msg.raid': 'Отряд противника идёт на наши постройки!',
  'ai.msg.split': 'Противник атакует с двух направлений!',
  'ai.msg.probe': 'Разведка противника прощупывает оборону.',
};

export const en = {
  // --- objectives and mission flow (game.js)
  'game.objective.hq.intact': 'HQ intact',
  'game.objective.hq.destroyed': 'HQ destroyed',
  'game.objective.timeLeft': '{time} remaining',
  'game.objective.done': 'Objective complete: {title}.',
  'game.kind.campaign': 'Operation',
  'game.kind.endless': 'Protocol',
  'game.kind.trial': 'Trial',
  'game.mission.begin': '{kind} "{title}". {subtitle}',
  'game.mission.first': 'Objective: {title}. {desc}',

  // --- match start and hints
  'game.begin.link': 'Link established. The colony is under your command.',
  'game.begin.hint': 'Build barracks and keep engineers close: without them, construction stalls.',
  'game.hint.oil': 'Oil derricks earn credits. Capture neutral oil patches.',
  'game.hint.engineer': 'Buildings only rise near engineers. The more you have, the faster they build.',
  'game.hint.enemy': 'Sensors detect enemy activity. Fortify your defenses.',
  'game.alert.base': 'Our base is under attack!',

  // --- construction, repair, selling
  'game.build.started': 'Construction started: {name}',
  'game.build.requires': 'Build first: {names}.',
  'game.build.cancelled': 'Construction cancelled. 60% of the cost refunded.',
  'game.build.sold': '{name}: sold. {refund} credits refunded.',
  'game.build.noLink': 'No link to the construction system.',
  'game.repair.fullCost': '{started} Full repair: {cost} credits.',

  // --- squads and engineers
  'game.group.empty': 'Select units or buildings first to form a squad.',
  'game.group.set': 'Squad {index}: {count} units.',
  'game.idle.none': 'No idle engineers.',
  'game.idle.count': 'Idle engineers: {count}.',
  'game.word.object': 'item',
  'game.word.object.few': 'items',
  'game.word.object.many': 'items',
  'game.word.unit': 'unit',
  'game.word.unit.few': 'units',
  'game.word.unit.many': 'units',

  // --- orders
  'game.order.patrol': 'Patrol: the squad will move between its current position and the chosen point.',
  'game.order.hold': 'The squad holds position and will not pursue the enemy.',

  // --- research and training
  'game.mission.buildBlocked': 'This building is unavailable in this operation.',
  'game.mission.unitBlocked': 'This unit is unavailable in this operation.',
  'game.research.alreadyDone': 'This upgrade is already researched.',
  'game.research.alreadyQueued': 'This upgrade is already being researched.',
  'game.research.requiresLevel': 'Research the previous level first.',
  'game.research.started': 'Research started: {name}.',
  'game.research.complete': 'Research complete: {name}. {tail}',
  'game.research.scopeUnit': 'Squad reinforced.',
  'game.research.scopeBuilding': 'Buildings reinforced.',
  'game.research.scopeGlobal': 'The effect applies to the entire colony.',
  'game.train.locked': 'Requires "{name}" research.',

  // --- losses and kills
  'game.friendlyFire': 'A Tempest salvo hit your own forces. Do not fire on your own troops and buildings.',
  'game.derrick.enemyDown': 'Enemy oil derrick destroyed. Enemy income reduced.',
  'game.derrick.ownDown': 'Our oil derrick destroyed.',
  'game.lost': 'Lost: {name}',
  'game.killed': 'Destroyed: enemy {name}',

  // --- numbers (utils.js)
  'game.fmt.million': '{n}M',
  'game.fmt.thousand': '{n}k',

  // --- units and buildings (entities.js)
  'entity.rank': '{name}: rank "{rank}".',
  'entity.build.done': 'Construction complete: {name}',

  // --- input and hints (input.js)
  'input.camera.base': 'Camera returned to base.',
  'input.ghost.hint': 'Last known position of the building. The data may be outdated.',
  'input.oil.info': 'Oil patch. Build a derrick here to pump credits.',
  'input.builders.sent': 'Engineers sent to the construction site.',
  'input.oil.noCredits': 'Not enough credits for a derrick.',
  'input.oil.laid': 'Oil derrick foundation laid.',
  'input.hq.destroyed': 'Command center destroyed. Construction impossible.',
  'input.mode.attack': 'Pick an attack point. LMB — order, RMB — cancel.',
  'input.mode.patrol': 'Pick a patrol point. LMB — order, RMB — cancel.',
  'input.place.hint': 'Place: {name}. LMB — build, Shift+LMB — another one, RMB — cancel, R — rotate.',

  // --- map generator (mapgen.js)
  'map.style.rot180.name': 'Central',
  'map.style.rot180.hint': 'The second half of the map is the first rotated 180°.',
  'map.style.axis-x.name': 'Mirrored',
  'map.style.axis-x.tag': 'X AXIS',
  'map.style.axis-x.hint': 'Bases sit mirrored across the X axis.',
  'map.style.axis-z.name': 'Mirrored',
  'map.style.axis-z.tag': 'Z AXIS',
  'map.style.axis-z.hint': 'Bases sit mirrored across the Z axis.',
  'map.style.diagonal.name': 'Diagonal',
  'map.style.diagonal.hint': 'Bases sit mirrored across the X = Z diagonal.',
  'map.style.anti-diagonal.name': 'Diagonal',
  'map.style.anti-diagonal.hint': 'Bases sit mirrored across the X = −Z diagonal.',
  'map.palette.rust.name': 'RUST WASTELAND',
  'map.palette.basalt.name': 'BASALT FIELDS',
  'map.palette.ochre.name': 'OCHRE DUNES',
  'map.palette.ash.name': 'ASH ZONE',

  // --- enemy notifications (ai.js)
  'ai.msg.build': 'Sensors detect new enemy structures: the sector is filling up.',
  'ai.msg.scoutSector': 'Enemy recon is probing the sector.',
  'ai.msg.retreatOutgunned': 'Enemy squad is falling back: it ran into superior force.',
  'ai.msg.retreatFailed': 'Enemy squad is retreating: it could not break through.',
  'ai.msg.starved': 'The enemy is conserving its forces: troops are staying at base.',
  'ai.msg.hold': 'The enemy judged our army stronger and dares not attack.',
  'ai.msg.gather': 'The enemy is massing forces: a major strike looks likely.',
  'ai.msg.waveFirst': 'The enemy is advancing on our base!',
  'ai.msg.waveNext': 'Enemy wave #{index} is closing in!',
  'ai.msg.raid': 'An enemy squad is heading for our structures!',
  'ai.msg.split': 'The enemy is attacking from two directions!',
  'ai.msg.probe': 'Enemy recon is probing our defenses.',
};
