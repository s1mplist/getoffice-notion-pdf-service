import { NextRequest, NextResponse } from "next/server";
import { makePDFFromDomain } from "@/app/pdf";

// Padrões permitidos
const allowedOrigins = [
    'http://localhost:8000',
    'http://localhost:3000',
];

// Regex para validar domínios Vercel
const vercelPattern = /^https?:\/\/.*\.vercel\.app$/;

function getCorsHeaders(origin: string | null): Record<string, string> {
    const baseHeaders = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (!origin) {
        return {
            ...baseHeaders,
            'Access-Control-Allow-Origin': '*',
        };
    }

    // Verificar se é um domínio permitido ou match com padrão Vercel
    const isAllowed = allowedOrigins.includes(origin) || vercelPattern.test(origin);
    
    return {
        ...baseHeaders,
        'Access-Control-Allow-Origin': isAllowed ? origin : allowedOrigins[0],
        'Access-Control-Allow-Credentials': 'true',
    };
}

export async function OPTIONS(request: NextRequest) {
    const origin = request.headers.get('origin');
    const corsHeaders = getCorsHeaders(origin);
    return new NextResponse(null, { 
        status: 200, 
        headers: corsHeaders 
    });
}

export async function POST(request: NextRequest) {
    const origin = request.headers.get('origin');
    const corsHeaders = getCorsHeaders(origin);

    try {
        const body = await request.json();
        const { url } = body;

        if (!url || typeof url !== 'string') {
            return NextResponse.json(
                { error: 'URL é obrigatória' },
                { status: 400, headers: corsHeaders }
            );
        }

        try {
            new URL(url);
        } catch {
            return NextResponse.json(
                { error: 'URL inválida' },
                { status: 400, headers: corsHeaders }
            );
        }

        console.log(`[API] Generating PDF for URL: ${url}`);

        const pdfBuffer = await makePDFFromDomain(url);

        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="document.pdf"',
            },
        });
    } catch (error) {
        console.error("[API] Error generating PDF:", error);
        return NextResponse.json(
            { 
                error: 'Erro ao gerar PDF',
                details: error instanceof Error ? error.message : String(error)
            },
            { status: 500, headers: corsHeaders }
        );
    }
}

// Adicionar GET para debug
export async function GET(request: NextRequest) {
    const origin = request.headers.get('origin');
    return NextResponse.json(
        { 
            status: 'ok',
            message: 'PDF Service is running',
            origin: origin,
            allowed: origin ? (allowedOrigins.includes(origin) || vercelPattern.test(origin)) : false
        },
        { headers: getCorsHeaders(origin) }
    );
}