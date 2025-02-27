'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import postgres from 'postgres';
import { signIn } from '@/auth';
import { AuthError } from 'next-auth';

const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require' });

// console.info("Database connection established.");

const FormSchema = z.object({
  id: z.string().min(1, { message: 'Invalid invoice ID.' }),
  customerId: z.string({
    invalid_type_error: 'Please select a customer.',
  }),
  amount: z.coerce.number().min(0.01, { message: 'Amount must be greater than 0.' }),
  status: z.enum(['pending', 'paid'], { invalid_type_error: 'Please select an invoice status.' }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Invalid date format.' }),
});

const CreateInvoice = FormSchema.omit({ id: true, date: true });
const UpdateInvoice = FormSchema.omit({ id: true, date: true });

export type State = {
  errors?: {
    customerId?: string[];
    amount?: string[];
    status?: string[];
  };
  message?: string | null;
};

export async function createInvoice(prevState: State, formData: FormData) {
  console.info("Processing createInvoice...");

  // Validate form using Zod
  const validatedFields = CreateInvoice.safeParse({
    customerId: formData.get('customerId'),
    amount: formData.get('amount'),
    status: formData.get('status'),
  });

  if (!validatedFields.success) {
    console.warn("Validation failed for createInvoice.", validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Create Invoice.',
    };
  }

  const { customerId, amount, status } = validatedFields.data;
  const amountInCents = amount * 100;
  const date = new Date().toISOString().split('T')[0];

  // console.info(`Creating invoice for customerId: ${customerId}, amount: ${amountInCents}, status: ${status}`);

  try {
    await sql`
      INSERT INTO invoices (customer_id, amount, status, date)
      VALUES (${customerId}, ${amountInCents}, ${status}, ${date})
    `;
    console.info("Invoice created successfully.");
  } catch (error) {
    console.error("Database error: Failed to create invoice.", error);
    return {
      message: 'Database Error: Failed to Create Invoice.',
    };
  }

  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

export async function updateInvoice(prevState: State, formData: FormData) {
  const id = formData.get('id') as string; // Ambil ID dari formData

  if (!id) {
    return { message: "Invoice ID is missing", errors: { general: ["Invalid request"] } };
  }

  const validatedFields = UpdateInvoice.safeParse({
    customerId: formData.get("customerId"),
    amount: formData.get("amount"),
    status: formData.get("status"),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Missing Fields. Failed to Update Invoice.",
    };
  }

  const { customerId, amount, status } = validatedFields.data;
  const amountInCents = amount * 100;

  try {
    await sql`
      UPDATE invoices
      SET customer_id = ${customerId}, amount = ${amountInCents}, status = ${status}
      WHERE id = ${id}
      RETURNING *;
    `;
  } catch (error) {
    return { message: "Database Error: Failed to Update Invoice.", errors: { general: ["An error occurred"] } };
  }
  
  revalidatePath('/dashboard/invoices');
  redirect('/dashboard/invoices');
}

export async function deleteInvoice(id: string) {
  // console.info(`Processing deleteInvoice for ID: ${id}`);

  try {
    await sql`DELETE FROM invoices WHERE id = ${id}`;
    // console.info(`Invoice ID: ${id} deleted successfully.`);
    revalidatePath("/dashboard/invoices");
  } catch (error) {
    console.error(`Database error: Failed to delete invoice ID: ${id}`, error);
    throw new Error("Database Error: Failed to Delete Invoice.");
  }
}

export async function authenticate(prevState: string | undefined, formData: FormData) {
  console.info("Processing authentication...");

  try {
    await signIn('credentials', formData);
    console.info("Authentication successful.");
  } catch (error) {
    if (error instanceof AuthError) {
      console.warn(`Authentication failed: ${error.type}`);
      switch (error.type) {
        case 'CredentialsSignin':
          return 'Invalid credentials.';
        default:
          return 'Something went wrong.';
      }
    }
    console.error("Unexpected authentication error.", error);
    throw error;
  }
}