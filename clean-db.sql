-- Limpar banco de dados
-- Deletar na ordem correta para respeitar foreign keys

DELETE FROM "store_users";
DELETE FROM "stores";
DELETE FROM "users";
