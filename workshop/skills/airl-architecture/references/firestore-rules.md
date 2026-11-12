# Правила доступа Firestore — три готовых шаблона

Возьми шаблон под ответ на вопрос 2, подставь имя коллекции (`bookings` в примерах)
и **перечисли настоящие поля** в `hasOnly`. Больше ничего не меняй.

Общее для всех шаблонов:

- без входа нельзя ничего;
- при создании документа автор не может подставить чужой `ownerId`;
- поле `ownerId` нельзя поменять после создания;
- всё, что не разрешено явно, запрещено.

После правки: `npm run deploy` (публикует и сайт, и правила).

---

## A. Каждый видит только своё

Путь в коде: `users/{uid}/bookings/{id}`.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId}/bookings/{bookingId} {
      allow read, delete: if request.auth != null && request.auth.uid == userId;

      allow create, update: if request.auth != null
        && request.auth.uid == userId
        && request.resource.data.keys().hasOnly(['name', 'phone', 'service', 'date', 'createdAt']);
    }
  }
}
```

---

## B. Общий список для всех вошедших, правит только автор

Путь в коде: `bookings/{id}`, в документе `ownerId`.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /bookings/{bookingId} {
      allow read: if request.auth != null;

      allow create: if request.auth != null
        && request.resource.data.ownerId == request.auth.uid
        && request.resource.data.keys().hasOnly(['ownerId', 'name', 'phone', 'service', 'date', 'createdAt']);

      allow update: if request.auth != null
        && resource.data.ownerId == request.auth.uid
        && request.resource.data.ownerId == resource.data.ownerId
        && request.resource.data.keys().hasOnly(['ownerId', 'name', 'phone', 'service', 'date', 'createdAt']);

      allow delete: if request.auth != null
        && resource.data.ownerId == request.auth.uid;
    }
  }
}
```

---

## C. Клиенты видят своё, владелец — всё

Путь в коде: `bookings/{id}`, в документе `ownerId`. Клиент **обязан** читать с
фильтром `where("ownerId", "==", uid)`, иначе запрос целиком отклоняется с
«Missing or insufficient permissions» — правила не фильтруют, они разрешают или
запрещают запрос целиком.

Подставь почту владельца из вопроса 3. Почту пишем в нижнем регистре.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isOwnerOfApp() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email in ['owner@gmail.com'];
    }

    match /bookings/{bookingId} {
      allow read: if isOwnerOfApp()
        || (request.auth != null && resource.data.ownerId == request.auth.uid);

      allow create: if request.auth != null
        && request.resource.data.ownerId == request.auth.uid
        && request.resource.data.keys().hasOnly(['ownerId', 'name', 'phone', 'service', 'date', 'createdAt']);

      allow update: if isOwnerOfApp()
        || (request.auth != null
            && resource.data.ownerId == request.auth.uid
            && request.resource.data.ownerId == resource.data.ownerId
            && request.resource.data.keys().hasOnly(['ownerId', 'name', 'phone', 'service', 'date', 'createdAt']));

      allow delete: if isOwnerOfApp()
        || (request.auth != null && resource.data.ownerId == request.auth.uid);
    }
  }
}
```

В интерфейсе экран владельца показывай, только если почта совпадает, — но помни:
спрятанная кнопка ничего не защищает, защищают правила выше.

---

## Как проверить руками

1. Войти аккаунтом 1, создать запись.
2. Окно инкогнито, войти аккаунтом 2.
3. A и C — записи аккаунта 1 не видно. B — видно, но кнопок «изменить/удалить» нет,
   а попытка изменить через консоль браузера даёт ошибку прав.
4. C — войти почтой владельца: видны записи обоих.

## Чего не делать

- `allow read, write: if true;` — открыто всему интернету.
- `allow read, write: if request.time < timestamp.date(...)` — это тестовый режим,
  через месяц продукт сломается сам.
- `allow read, write: if request.auth != null;` для всей базы — любой человек с
  Google-аккаунтом читает и стирает чужие данные.
